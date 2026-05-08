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
  CloudAppRestService,
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
import { EMPTY, Observable, from, of, throwError } from "rxjs";
import {
  catchError,
  finalize,
  map,
  mergeMap,
  switchMap,
  take,
  tap,
} from "rxjs/operators";
import { DialogService } from "eca-components";
import { UserService } from "./user.service";
import { MatSelectChange } from "@angular/material/select";
import { MatSlideToggleChange } from "@angular/material/slide-toggle";
import { ARRAY_INDICATOR } from "../models/settings-utils";
import { NgxDropzoneChangeEvent } from "ngx-dropzone";

const MAX_PARALLEL_CALLS = 5;

const isRestErrorResponse = (object: any): object is RestErrorResponse =>
  "error" in object;

export interface CsvParseResult {
  data: any[];
  errors: string[];
}

@Component({
  selector: "app-main",
  templateUrl: "./main.component.html",
  styleUrls: ["./main.component.scss"],
})
export class MainComponent implements OnInit {
  /* Properties block */
  // Configuration
  config: Settings = { profiles: [] };
  selectedProfile!: Profile;
  user: any; // note: this property relates to the loggedin user, not a user for import

  // CSV input and prechecks
  files: File[] = [];
  missingFields: string[] = [];
  hasErrors: string[] = [];
  readonly ARRAY_INDICATOR = ARRAY_INDICATOR; // regex used to verify if a dot-object Alma field allows multiple entries

  // Results
  @ViewChild("resultsPanel", { static: false })
  private resultsPanel?: ElementRef<HTMLElement>;
  syncSet: { [key: string]: any } = {};
  results: any[] = [];
  resultLog: string[] = [];
  resultsSummary: string|undefined = '';
  processed = 0;
  recordsToProcess = 0;
  showLog: boolean = false;

  // UI management
  running: boolean = false;
  loading: boolean = false;
  // Columns selection for profile overviews
  displayedColumns = {
    Base: ["header", "default", "name"],
    Update: ["header", "default", "name", "swap"],
  };
  get showColumns() {
    return ['UPDATE', 'SYNC'].includes(this.selectedProfile.profileType)
      ? this.displayedColumns["Update"]
      : this.displayedColumns["Base"];
  }
  // Progress bar
  get percentComplete() {
    return Math.round((this.processed / this.recordsToProcess) * 100);
  }

  /* *** Methods group 0: component initialization *** */
  constructor(
    private configService: CloudAppConfigService,
    private userService: UserService,
    private papa: Papa,
    private translate: TranslateService,
    private dialogs: DialogService,
    private storeService: CloudAppStoreService,
    private restService: CloudAppRestService,
  ) {}

  // Original method keep
  ngOnInit() {
    this.loading = true;

    // Collect loggedin user and set language based on user account. On error, use default language 'en'
    this.restService.call<any>("/almaws/v1/users/ME").subscribe(
      (user) => {
        this.user = user;
        this.translate.use(this.user.preferred_language.value);
        //console.log("Logged in user language: ", this.user.preferred_language.value  );
      },
      (err) => {
        console.error("Could not retrieve user data: " + err.message);
        this.translate.use("en");
      },
    );

    // Load configuration
    this.configService.get().subscribe(
      (config) => {
        this.config = config as Settings;
        //console.log('Successfully loaded configuration: ', this.config);
        if (this.config.profiles && this.config.profiles.length > 0) {
          this.selectedProfile = this.config.profiles[0];

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
        }
        else{
        this.loading = false;
        }
      },
      (err) => {
        console.error("An error occurred while loading configuration: ", err);
        this.hasErrors.push('Could not load app configuration. Try closing and reopening the app. If the problem persists, contact your library helpdesk.');
        this.loading = false;
      },
    );

    this.storeService.get("showLog").subscribe((val) => (this.showLog = val));
  }

  /* *** Methods group 1: user interactions management *** */

  // Original method keep
  // Push current profile selection to browser cache
  onSelectProfile(event: MatSelectChange) {
    this.storeService.set("profile", event.value.name).subscribe();
  }

  // Original method keep
  // Add files to processing list
  onSelect(event: NgxDropzoneChangeEvent) {
    console.log("Add file event type: ", typeof event);
    this.files = event.addedFiles;
    this.hasErrors = [];
    console.log("New list of files: ", this.files);
  }

  // Original method keep
  // Remove files from processing list
  onRemove(event: File) {
    console.log("Remove file event type: ", event);
    this.files.splice(this.files.indexOf(event), 1);
    this.hasErrors = [];
    console.log("New list of files: ", this.files);
  }
  // Original method keep
  // Clear/start new workflow
  reset() {
    this.files = [];
    this.hasErrors = [];
    this.syncSet = {};
    this.results = [];
    this.resultLog = [];
    this.resultsSummary = "";
    this.processed = 0;
    this.recordsToProcess = 0;
    this.missingFields = [];
  }
  // Original method keep
  // Method to compare profiles - usage status unknown
  compareProfiles(o1: Profile, o2: Profile): boolean {
    return o1 && o2 ? o1.name === o2.name : o1 === o2;
  }

  // Original method keep
  // Scroll functionality
  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  // Final method candidate
  // Scroll functionality
  scrollToBottom(): void {
    if (!this.resultsPanel) {
      return;
    }
    this.resultsPanel.nativeElement.scrollTop =
      this.resultsPanel.nativeElement.scrollHeight;
  }

  // Old method - refactored to improve Angular style
  // scrollToBottom(): void {
  //   try {
  //     this.resultsPanel.nativeElement.scrollTop =
  //       this.resultsPanel.nativeElement.scrollHeight;
  //   } catch (err) {}
  // }

  // Original method keep
  // Results log toggle
  showLogChanged(event: MatSlideToggleChange) {
    this.storeService.set("showLog", event.checked).subscribe();
  }

  // Final candidate method
  syncUsers() {
    console.log(
      "Initializing user sync procedure with fileset: ",
      this.files[0],
    );

    // Before starting the load process, verify if the uploaded CSV matches the selected profile settings
    console.log("Starting with CSV validation");
    this.parseCSV(this.files[0])
      .pipe(
        catchError((err) => {
          console.log("Error while parsing CSV: ", err);
          this.hasErrors.push(...err);
          return EMPTY;
        }),
        
        switchMap((users) =>
          this.confirmImport(users).pipe(
            take(1),
            switchMap((confirm) => {
              if (!confirm) {
                console.log("User cancelled import after confirmation dialog");
                return EMPTY;
              }
              console.log("User confirmed import after confirmation dialog - starting import with user set: ", users);
              return of(users);
            }),
          ),
        ),

        switchMap((users) => {
          if (this.selectedProfile.profileType === "SYNC") {
            this.loading = true;
            console.log("Profile type is Sync - starting to collect all users");
            return this.userService.getAllUsers().pipe(
              tap((allUsers) => {
                console.log("Succesfully collected all users: ", allUsers);
                console.log('First user in set: ', allUsers[0]);
                this.syncSet = allUsers.reduce<Record<string, any>>(
                  (allUsers, user) => {
                    allUsers[user.primary_id] = user;
                    return allUsers;
                  },
                  {},
                );
                console.log("Finished building sync user set: ", this.syncSet);
                this.loading = false;
              }),
              map(() => users),
              catchError((err) => {
                this.hasErrors.push(
                  `Could not collect sync user set. Please retry later.`,
                );
                console.log("Error while collecting full userset: ", err);
                this.loading = false;
                return EMPTY;
              }),
            );
          }
          console.log(
            "Profile type is not sync: ",
            this.selectedProfile.profileType,
          );
          console.log("Current set of users to process: ", users);
          return of(users);
        }),

        switchMap((users) =>
          this.processUsers(users).pipe(
            tap((res) => this.results.push(res)),
              catchError((err) => {
                console.log("Unexpected stream failure: ", err);
                this.hasErrors.push(`Unexpected error during user processing: ${err.message}`);
                return EMPTY;
              }),
              finalize(() => {
                console.log('Finished processing complete user batch: ', this.processed);
                this.calculateResultsSummary_new();
              })
            ),
        ),
      )
      .subscribe();
  }

  // Final candidate method
  private calculateResultsSummary_new() {
    console.log('Current results array: ', this.results);
    let successCount = 0;
    let errorCount = 0;
    this.results.forEach((res) => {
      if(res.success){
        successCount++;
        this.resultLog.push(`${this.translate.instant("Main.Processed")}: ${res.action} (${res.data.primary_id})`);        
      } else {
        errorCount++;
        this.resultLog.push(`${this.translate.instant("Main.Failed")}: ${res.error.message}`);
      }
    });
    // Generate results summary
    this.resultsSummary = this.translate.instant("Main.ResultsSummary", { successCount, errorCount });
    console.log('Logging results: ', this.resultLog);
    this.running = false;
  }

  // Old method backup
  private calculateResultsSummary(){
    console.log("Calculating results summary for result set: ", this.results);
    let successCount = 0;
    let errorCount = 0;
    this.results.forEach((res) => {
      if(isRestErrorResponse(res)){
        errorCount++;
        this.resultLog.push(`${this.translate.instant("Main.Failed")}: ${res.message}`);
      } else{
        successCount++;
        this.resultLog.push(`${this.translate.instant("Main.Processed")}: ${res/*.primary_id*/}`);
      }
    });
    // Generate results summary
    this.resultsSummary = this.translate.instant("Main.ResultsSummary", { successCount, errorCount });
    this.running = false;                
  }

  // Final candidate method
  processUsers(users: any[]){
    // The user input comes in the form of a raw set of CSV rows. They have been validated, but not yet processed.
    // Therefore start by turning them into user objects
    console.log("Starting user processing with CSV user set: ", users);
    const parsedUsers = users.map((user) => this.userService.buildCsvUser(user, this.selectedProfile));
    console.log("Finished pre-processing users into sync users: ", parsedUsers);

    console.log('Calculating concurrency limit.')
    const parallel = parsedUsers.every((user) => user.primary_id) ? MAX_PARALLEL_CALLS  : 1;
    console.log("Set maximal parallel calls to ", parallel);

    console.log('Set up monitoring tools');
    this.recordsToProcess = parsedUsers.length;
    this.running = true;
    console.log("Right before processing starts: ",this.recordsToProcess, this.running);

    // If userset is empty, return immediately
      if(parsedUsers.length === 0){
        this.hasErrors.push('Userset is empty.');
        this.running = false;
    return EMPTY;
  }

  return from(parsedUsers).pipe(
    mergeMap(
      user => 
        this.userService.processSingleUser(user, this.selectedProfile.profileType, this.checkSyncUser(user)).pipe(
          catchError( err => {
            return of(err);}
          ),
          finalize(() => {this.processed++;})
        ),
        parallel
    ))
  }

// Final candidate method
private checkSyncUser(user: any): any|null {
  if(this.selectedProfile.profileType === 'SYNC'){
    return this.syncSet[user.primary_id] ?? null;
  }
  return null;
}

  /* *** Methods group 3: Main processing method *** */
  
  // Final candidate method
  // Method to confirm user import
  confirmImport(users: any[]): Observable<boolean> {
    console.log("Opening confirmation dialog");
    return this.dialogs.confirm({
      text: [
        "Main.ConfirmCreateUsers",
        { count: users.length, type: this.selectedProfile.profileType },
      ],
    });
  }

  /* *** Methods group 4: CSV parsing and prechecks *** */
  // Final candidate method
  parseCSV(file: File): Observable<any[]> {
    return new Observable((observer) => {
      this.papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        complete: (result) => {
          const parseErrors: string[] = [];

          const missingFields = this.CheckCSV(result, this.selectedProfile);
          if (missingFields.length > 0) {
            parseErrors.push(
              `CSV does not match expected structure - the following fields are missing: ${missingFields.join(", ")}`,
            );
          }

          if (result.errors.length > 0) {
            parseErrors.push(
              ...result.errors.map(
                (e) =>
                  `CSV parsing error on line ${e.row + 1}: ${e.code} - ${e.message}`,
              ),
            );
          }

          if (parseErrors.length > 0) {
            observer.error(parseErrors);
          }

          observer.next(result.data);
          observer.complete();
        },
        error: (err) =>
          observer.error([
            `CSV file could not be parsed. Please check your file`,
          ]),
      });
    });
  }

  // Final candidate method
  // Compares CSV header from parseResult with the field list of a specific profile
  private CheckCSV(result: ParseResult, selectedProfile: Profile): string[] {
    console.log("Entering CSV field check method for result: ", result);
    let missing: string[] = [];
    selectedProfile.fields.forEach((f) => {
      if (f.header !== "" && !result.meta.fields.includes(f.header)) {
        missing.push(f.header);
      }
    });
    return missing;
  }
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


