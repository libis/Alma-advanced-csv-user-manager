import {
  Component,
  OnInit,
  ViewChild,
  ElementRef,
  Injectable,
  inject,
} from "@angular/core";
import { Papa, ParseResult } from "ngx-papaparse";
import { Settings, Profile } from "../models/settings";
import {
  CloudAppConfigService,
  CloudAppStoreService,
  RestErrorResponse,
} from "@exlibris/exl-cloudapp-angular-lib";
import {
  Router,
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from "@angular/router";
import { TranslateService } from "@ngx-translate/core";
import { Observable, from } from "rxjs";
import { map, mergeMap, tap } from "rxjs/operators";
import { DialogService } from "eca-components";
import { UserService } from "./user.service";
import { MatSelectChange } from "@angular/material/select";
import { MatSlideToggleChange } from "@angular/material/slide-toggle";
import { ARRAY_INDICATOR } from "../models/settings-utils";

const MAX_PARALLEL_CALLS = 5;

@Component({
  selector: "app-main",
  templateUrl: "./main.component.html",
  styleUrls: ["./main.component.scss"],
})
export class MainComponent implements OnInit {
  files: File[] = [];
  config: Settings;
  selectedProfile: Profile;
    displayedColumns = {
    'Base': ['header', 'default', 'name'],
    'Update': ['header', 'default', 'name','swap']
  };
  missingFields: string[] = [];
  results = "";
  resultsSummary: string;
  showLog = false;
  processed = 0;
  recordsToProcess = 0;
  running: boolean;
  loading: boolean = false;
  @ViewChild("resultsPanel", { static: false })
  private resultsPanel: ElementRef;
  readonly ARRAY_INDICATOR = ARRAY_INDICATOR;

  constructor(
    private configService: CloudAppConfigService,
    private userService: UserService,
    private papa: Papa,
    private translate: TranslateService,
    private dialogs: DialogService,
    private storeService: CloudAppStoreService,
  ) {}

  ngOnInit() {
    this.loading = true;
    this.configService.get().subscribe(
      (config) => {
        this.config = config as Settings;
        if(this.config.profiles && this.config.profiles.length >0){
        this.selectedProfile = this.config.profiles[0]
      }

        // Get stored data from storeService
        this.storeService.get("profile").subscribe(
          (val) => {
            if (!!val) {
              this.config.profiles.forEach((p) => {
                if (p.name == val) this.selectedProfile = p;
              });
            }
            this.loading = false;
          },
          (err) => {
            console.error("An error occurred while loading configuration: ", err);
            this.loading = false;
          },
          () => {
            this.loading = false;
          },
        );
      },
      (err) => {
        console.error("An error occurred while loading configuration: ", err);
        this.loading = false;
      },
    );

    this.storeService.get("showLog").subscribe((val) => (this.showLog = val));
  }

  onSelectProfile(event: MatSelectChange) {
    this.storeService.set("profile", event.value.name).subscribe();
  }

  onSelect(event) {
    this.files.push(...event.addedFiles);
  }

  onRemove(event) {
    this.files.splice(this.files.indexOf(event), 1);
  }

  reset() {
    this.files = [];
    this.results = "";
    this.resultsSummary = "";
    this.processed = 0;
    this.recordsToProcess = 0;
    this.missingFields = [];
  }

  compareProfiles(o1: Profile, o2: Profile): boolean {
    return o1 && o2 ? o1.name === o2.name : o1 === o2;
  }

  get showColumns() {return this.selectedProfile.profileType === 'UPDATE' ? this.displayedColumns['Update']: this.displayedColumns['Base']}

  // Method to parse csv files - calls the parse method
  load() {
    this.papa.parse(this.files[0], {
      header: true,
      complete: this.parsed,
      skipEmptyLines: "greedy",
    });
  }

  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  scrollToBottom(): void {
    try {
      this.resultsPanel.nativeElement.scrollTop =
        this.resultsPanel.nativeElement.scrollHeight;
    } catch (err) {}
  }

  showLogChanged(event: MatSlideToggleChange) {
    this.storeService.set("showLog", event.checked).subscribe();
  }

  get percentComplete() {
    return Math.round((this.processed / this.recordsToProcess) * 100);
  }

  private CheckCSV(result: ParseResult, selectedProfile: Profile): string[] {
    let missing = [];
    selectedProfile.fields.forEach((f) => {
      if ((f.header !== '') && (!result.meta.fields.includes(f.header))){
        missing.push(f.header);
      }
    });
    return missing;
  }

  private log = (str: string) => (this.results += `${str}\n`);

  private parsed = async (result: ParseResult) => {

    this.missingFields = this.CheckCSV(result, this.selectedProfile);
    if (this.missingFields.length > 0) {
      console.error("CSV file has missing fields: ", this.missingFields.join(", "));
    }

    if (result.errors.length > 0) {console.warn("Errors:", result.errors)};

    let users: any[] = result.data.map((row) =>this.userService.buildCsvUser(row, this.selectedProfile)), results = [];
    
    /* Generation of primary ID is not thread safe; only parallelize if primary ID is supplied */
    const parallel = users.every((user) => user.primary_id) ? MAX_PARALLEL_CALLS : 1;
    this.dialogs.confirm({
        text: ["Main.ConfirmCreateUsers", { count: users.length, type: this.selectedProfile.profileType }],
      })
      .subscribe((result) => {
        if (!result) {
          this.results = "";
          return;
        }
        this.recordsToProcess = users.length;
        this.running = true;
        from(
          users.map((user) =>
            this.userService.processCustomUser(user, this.selectedProfile.profileType)
              .pipe(tap(() => this.processed++)),
          ),
        )
          .pipe(mergeMap((obs) => obs, parallel))
          .subscribe({
            next: (result) => results.push(result),
            complete: () => {
              setTimeout(() => {
                let successCount = 0,
                  errorCount = 0;
                results.forEach((res) => {
                  if (isRestErrorResponse(res)) {
                    errorCount++;
                    this.log(
                      `${this.translate.instant("Main.Failed")}: ${res.message}`,
                    );
                  } else {
                    successCount++;
                    this.log(
                      `${this.translate.instant("Main.Processed")}: ${res.primary_id}`,
                    );
                  }
                });
                this.resultsSummary = this.translate.instant(
                  "Main.ResultsSummary",
                  { successCount, errorCount },
                );
                this.running = false;
              }, 500);
            },
          });
      });
  };
}

@Injectable({
  providedIn: "root",
})
export class MainGuard implements CanActivate {
  constructor(
    private settingsService: CloudAppConfigService,
    private router: Router,
  ) {}
  canActivate(
    next: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean> {
    return this.settingsService.get().pipe(
      map((settings) => {
        if (!settings.profiles) {
          this.router.navigate(["settings"]);
          return false;
        }
        return true;
      }),
    );
  }
}

const isRestErrorResponse = (object: any): object is RestErrorResponse =>
  "error" in object;
