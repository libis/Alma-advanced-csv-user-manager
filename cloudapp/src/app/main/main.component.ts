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
  success: boolean;
  action: string;
  data?: any[];
  errors?: string[];
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
  authorized: boolean = false;

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

  // Initialize component
  ngOnInit() {
    this.loading = true;

    // Collect loggedin user and set language based on user account. On error, use default language 'en'
    this.restService.call<any>("/almaws/v1/users/ME").subscribe(
      (user) => {
        this.user = user;
        this.translate.use(this.user.preferred_language.value);
        console.log("Logged in user language: ", this.user.user_role);
        //console.log("has API role: ", this.user.user_role.filter(r => r.role_type.desc === 'API Infra Read'));
        //console.log("has user manager role: ", this.user.user_role.filter(r => r.role_type.desc === 'User Manager'));
        if (this.user.user_role.filter(r => r.role_type.desc === 'API Infra Read' && r.status.value === 'ACTIVE').length > 0 && this.user.user_role.filter(r => r.role_type.desc === 'User Manager' && r.status.value === 'ACTIVE').length > 0) {
          this.authorized = true;
        }
        console.log("Authorized user: ", this.authorized);
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
              console.error("An error occurred while loading profile preference: ", err);
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
        this.hasErrors.push(this.translate.instant("Main.ConfigError"));
        this.loading = false;
      },
    );

    this.storeService.get("showLog").subscribe((val) => (this.showLog = val));
  }

  /* *** Methods group 1: user interactions management *** */

  // Push current profile selection to browser cache
  onSelectProfile(event: MatSelectChange) {
    this.storeService.set("profile", event.value.name).subscribe();
  }

  // Add file to the processing list - the upload zone accepts only csv files, all other files will be rejected immediately
  // Loading of multiple files is not supported. If a new file is selected, the previously selected file will be replaced.
  onSelect(event: NgxDropzoneChangeEvent) {
    //console.log("Add file event type: ", typeof event);
    this.files = event.addedFiles;
    // Reset error zone
    this.hasErrors = [];
    //console.log("New list of files: ", this.files);
  }

  // Remove files from processing list
  onRemove(event: File) {
    //console.log("Remove file event type: ", event);
    this.files.splice(this.files.indexOf(event), 1);
    this.hasErrors = [];
    //console.log("New list of files: ", this.files);
  }

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
    this.running = false;
    this.loading = false;
  }

  // Method to compare profiles
  compareProfiles(o1: Profile, o2: Profile): boolean {
    return o1 && o2 ? o1.name === o2.name : o1 === o2;
  }

  // Scroll functionality
  ngAfterViewChecked() {
    this.scrollToBottom();
  }

  // Scroll functionality
  scrollToBottom(): void {
    if (!this.resultsPanel) {
      return;
    }
    this.resultsPanel.nativeElement.scrollTop =
      this.resultsPanel.nativeElement.scrollHeight;
  }

  // Results log toggle
  showLogChanged(event: MatSlideToggleChange) {
    this.storeService.set("showLog", event.checked).subscribe();
  }

  // Main user import method - started through 'load'-button
  syncUsers() {
    //console.log("Initializing user sync procedure with fileset: ", this.files[0]);

    // Before starting the load process, verify the validity of the uploaded csv file. This method will stop the workflow and show the errors when:
    // - the file cannot be parsed correctly, e.g. invalid formatting, invalid lines
    // - the file is missing fields defined in the selected profile
    //console.log("Starting with CSV validation");
    this.parseCSV(this.files[0])
      .pipe(
        catchError((err) => {
          //console.log("Error while parsing CSV: ", err);
          this.hasErrors.push(...err);
          return EMPTY;
        }),
        
        // After successful parsing, ask user confirmation to proceed - the number of users to process is shown in the popup
        switchMap((users) =>
          this.confirmImport(users).pipe(
            take(1),
            switchMap((confirm) => {
              if (!confirm) {
                //console.log("User cancelled import after confirmation dialog");
                return EMPTY;
              }
              //console.log("User confirmed import after confirmation dialog - starting import with user set: ", users);
              return of(users);
            }),
          ),
        ),

        // If a Sync-profile is selected, load the full userset for syncing purposes
        // Sync users are stored in a dictionary with their primary_id as key to allow for matching with csv users
        switchMap((users) => {
          if (this.selectedProfile.profileType === "SYNC") {
            this.loading = true;
            //console.log("Profile type is Sync - starting to collect all users");
            return this.userService.getAllUsers().pipe(
              tap((allUsers) => {
                //console.log("Succesfully collected all users: ", allUsers);
                //console.log('First user in set: ', allUsers[0]);
                this.syncSet = allUsers.reduce<Record<string, any>>(
                  (allUsers, user) => {
                    allUsers[user.primary_id] = user;
                    return allUsers;
                  },
                  {},
                );
                //console.log("Finished building sync user set: ", this.syncSet);
                this.loading = false;
              }),
              map(() => users),
              // On error, the workflow will stop, as import correctness cannot be assured based on an incomplete sync set.
              catchError((err) => {
                this.hasErrors.push(
                  this.translate.instant("Main.SyncSetError"),
                );
                //console.log("Error while collecting full userset: ", err);
                this.loading = false;
                return EMPTY;
              }),
            );
          }
          //console.log("Profile type is not sync: ", this.selectedProfile.profileType);
          //console.log("Current set of users to process: ", users);
          return of(users);
        }),

        // Process users one by one. If a primary_id column is defined, parallel processing will be applied
        switchMap((users) =>
          this.processUsers(users).pipe(
            tap((res) => this.results.push(res)),
              catchError((err) => {
                //console.log("Unexpected stream failure: ", err);
                this.hasErrors.push(`${this.translate.instant('Main.UnknownError')}${err.message}`);
                return EMPTY;
              }),
              finalize(() => {
                //console.log('Finished processing complete user batch: ', this.processed);
                this.calculateResultsSummary_new();
              })
            ),
        ),
      )
      .subscribe();
  }

  // Generate results summary
  private calculateResultsSummary_new() {
    //console.log('Current results array: ', this.results);
    let successCount = 0;
    let errorCount = 0;
    this.results.forEach((res) => {
      if(res.success){
        successCount++;
        this.resultLog.push(`${this.translate.instant("Main.Processed", {action:res.action})} (${res.data.primary_id})`);        
      } else {
        errorCount++;
        this.resultLog.push(`${this.translate.instant("Main.Failed", {action: res.action})}: ${res.error.message}`);
      }
    });
    this.resultsSummary = this.translate.instant("Main.ResultsSummary", { successCount, errorCount });
    //console.log('Logging results: ', this.resultLog);
    this.running = false;
  }

  // Main method used to process the set of csv users
  processUsers(users: any[]){
    // The user input comes in the form of a raw set of CSV rows. They have been validated, but not yet processed.
    // Therefore start by turning them into user objects
    //console.log("Starting user processing with CSV user set: ", users);
    const parsedUsers = users.map((user) => this.userService.buildCsvUser(user, this.selectedProfile));
    //console.log("Finished pre-processing users into sync users: ", parsedUsers);

    // Parallel processing is applied only when primary IDs are supplied, as the Create action of the Alma users API is not thread-safe
    //console.log('Calculating concurrency limit.')
    const parallel = parsedUsers.every((user) => user.primary_id) ? MAX_PARALLEL_CALLS  : 1;
    //console.log("Set maximal parallel calls to ", parallel);

    //console.log('Set up monitoring tools');
    this.recordsToProcess = parsedUsers.length;
    this.running = true;
    //console.log("Right before processing starts: ",this.recordsToProcess, this.running);

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

// Method to match sync user. Will return null if no match is found or if the profiles does not require a sync user
private checkSyncUser(user: any): any|null {
  if(this.selectedProfile.profileType === 'SYNC'){
    return this.syncSet[user.primary_id] ?? null;
  }
  return null;
}

  /* *** Methods group 3: Main processing method *** */
  
  // Confirmation dialog
  confirmImport(users: any[]): Observable<boolean> {
    //console.log("Opening confirmation dialog");
    return this.dialogs.confirm({
      text: [
        "Main.ConfirmCreateUsers",
        { count: users.length, type: this.selectedProfile.profileType },
      ],
    });
  }

  /* *** Methods group 4: CSV parsing and prechecks *** */
  // CSV parsing method - includes error checks
  parseCSV(file: File): Observable<any[]> {
    return new Observable((observer) => {
      this.papa.parse(file, {
        header: true,
        skipEmptyLines: "greedy",
        complete: (result) => {
          const parseErrors: string[] = [];

          // Verify that all fields defined in the profile are present
          const missingFields = this.CheckCSV(result, this.selectedProfile);
          if (missingFields.length > 0) {
            parseErrors.push(
              this.translate.instant("Main.FieldMismatchError") + `${missingFields.join(", ")}`,
            );
          }

          // Check for csv parsing errors
          if (result.errors.length > 0) {
            parseErrors.push(
              ...result.errors.map(
                (e) =>
                  `${this.translate.instant("Main.CsvParseError")} ${e.row + 1}: ${e.code} - ${e.message}`,
              ),
            );
          }

          // If errors are found, return error observable
          if (parseErrors.length > 0) {
            observer.error(parseErrors);
          }

          // If no errors are found, return parsed csv data as observable
          observer.next(result.data);
          observer.complete();
        },
        error: (err) =>
          observer.error([
            this.translate.instant("Main.CsvError")
          ]),
      });
    });
  }

  
  // Compares CSV header from parseResult with the field list of a specific profile
  private CheckCSV(result: ParseResult, selectedProfile: Profile): string[] {
    //console.log("Entering CSV field check method for result: ", result);
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