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
import { catchError, map, mergeMap, switchMap, tap } from "rxjs/operators";
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
  syncSet: {[key:string]: any} = {};
  results: string | undefined = undefined;
  resultsSummary: string | undefined = undefined;
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
    return this.selectedProfile.profileType === "UPDATE"
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

  ngOnInit() {
    this.loading = true;

    // Collect loggedin user
    this.restService.call<any>("/almaws/v1/users/ME").subscribe(
      (user) => {
        this.user = user;
        this.translate.use(this.user.preferred_language.value);
        console.log(
          "Logged in user language: ",
          this.user.preferred_language.value,
        );
      },
      (err) => {
        console.log("Could not retrieve user data: " + err.message);
        this.translate.use("en");
      },
    );

    // Load configuration
    this.configService.get().subscribe(
      (config) => {
        this.config = config as Settings;
        if (this.config.profiles && this.config.profiles.length > 0) {
          this.selectedProfile = this.config.profiles[0];
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
            console.error(
              "An error occurred while loading configuration: ",
              err,
            );
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

  /* *** Methods group 1: user interactions management *** */

  // Push current profile selection to browser cache
  onSelectProfile(event: MatSelectChange) {
    this.storeService.set("profile", event.value.name).subscribe();
  }

  // Add files to processing list
  onSelect(event) {
    console.log("Add file event type: ", typeof event);
    this.files.push(...event.addedFiles);
  }

  // Remove files from processing list
  onRemove(event) {
    console.log("Remove file event type: ", typeof event);
    this.files.splice(this.files.indexOf(event), 1);
  }

  // Clear/start new workflow
  reset() {
    this.files = [];
    this.hasErrors = [];
    this.syncSet = {};
    this.results = "";
    this.resultsSummary = "";
    this.processed = 0;
    this.recordsToProcess = 0;
    this.missingFields = [];
  }

  // Method to compare profiles - usage status unknown
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

  // Old method - refactored to improve Angular style
  // scrollToBottom(): void {
  //   try {
  //     this.resultsPanel.nativeElement.scrollTop =
  //       this.resultsPanel.nativeElement.scrollHeight;
  //   } catch (err) {}
  // }

  // Results log toggle
  showLogChanged(event: MatSlideToggleChange) {
    this.storeService.set("showLog", event.checked).subscribe();
  }

  /* *** Methods group 3: Main processing method *** */
  sync() {
    console.log("Initiating sync procedure with fileset: ", this.files[0]);

    // Before starting the load process, verify if the uploaded CSV matches the selected profile settings
    const verify: boolean = this.validateCSV(this.files[0]);
    if (!verify) {
      return;
    }

    // If structure verification succeeds, parse the full CSV. If errors are encountered, end the workflow and show errors
    const parsedCSV = this.parseCSV(this.files[0]);
    if (this.hasErrors.length > 0) {
      return;
    }

    // Transform all users to a csv user object
    console.log("Starting user mapping procedure");
    let users: any[] = parsedCSV.data.map((row: { [key: string]: string }) =>
        this.userService.buildCsvUser(row, this.selectedProfile),
      )
    console.log("Finished mapping csv users: ", users);

    


    // If the selected profile is of type 'Sync', load the full userset. If this fails, do not proceed.
    console.log('If a sync profile is active, at this point the full userset is loaded')
    if (this.selectedProfile.profileType === 'SYNC'){
      console.log('Detected sync profile - starting full user load')
      this.loading = true

      this.userService.getAllUsers().subscribe(
        (userSet) => {
          console.log('Finished collecting full userset with user count: ', userSet.length);
          this.syncSet = users.reduce<Record<string, any>>((allUsers, user) => {
            allUsers[user.id]=user;
            return allUsers;
          }, {});
          this.loading = false;
          this.importUsers(users);
        },
        (err) => {
          console.error('Could not load syncSet due to error: ', err.message);
          this.hasErrors.push('Failed to load full user set for user sync - please retry');
          this.loading = false;
          return
        },
        () => {
          this.loading = false;
        }        
      )
    }
    // Proceed directly with the import method
    else {
      this.importUsers(users);
    }
  }

  // Method to confirm user import
  confirmImport(users: any[]): Observable<boolean>{
    console.log("Opening confirmation dialog");
    return this.dialogs
      .confirm({
        text: [
          "Main.ConfirmCreateUsers",
          { count: users.length, type: this.selectedProfile.profileType },
        ],
      })
    }

  // Method to effect Alma import of users
  importUsers(users: any[]){
    
    this.confirmImport(users).pipe(
      // Confirm user import through popup
      switchMap(
        resp => {
          if(!resp){
            return EMPTY;
          }

          this.loading = true;

          // If the profiletype is 'SYNC', collect full userset for user sync purposes
          if(this.selectedProfile.profileType === 'SYNC'){
            return this.userService.getAllUsers().pipe(
              tap(userSet => {
                console.log('Finished collecting full userset with user count: ', userSet.length);
                this.syncSet = users.reduce<Record<string, any>>((allUsers, user) => {
                    allUsers[user.id]=user;
                    return allUsers;
                    }, {});
                this.loading = false;
              }),
              catchError(err => {
                console.error('Error while loading syncSet: ', err);
                return throwError(() => err)
              })
            );
          }
          // Else skip this step = return observable of null to keep the flow going
          return of(null);
        }),
        // After the previous steps have completed successfully, start processing users
        switchMap(() =>
          this./*userService.*/processUserSet(users, this.syncSet).pipe(
            catchError(err => {
              console.error('Error while processing users');
              return throwError(() => err);
            })
          )
        ),
        // Global error handler
        catchError(err => {
          console.error('Could not start user processing due to error: ', err);
          return EMPTY;
        })
        // Subscribe to result of user processing method
      ).subscribe(
        (results) => {
          this.results = ((results).join('/n'));
        },
        (err) => {
          console.error('Could not complete user processing due to error: ', err);
        });
      }
 

    processUserSet(users: any[], syncSet: {[key:string]:any}):Observable<string[]>{

      // Setup results array to collect results of individual update actions
      const updateResults: any[] = [];
    // Verify if each user in the import has a primary ID
    // If not, parallel processing is not possible,because Alma user creation without preset patron ID is not thread-safe
      const parallel = users.every((user) => user.primary_id) ? MAX_PARALLEL_CALLS : 1;
      console.log('Set maximal parallel calls to ', parallel);

        this.recordsToProcess = users.length;
        this.running = true;
        console.log("Right before processing starts");

        // Loop over users array and turn each into an observable that calls the processing method
        // The result is an array of observables (which are not yet doing anything)
        from(
          users.map((user) => this.userService.processCustomUser(user, this.selectedProfile.profileType)
            .pipe(tap(() => this.processed++)),
        )
        // Run the user processing with concurrency control, with parallel controlling how many calls are performed at the same time
        ).pipe(mergeMap((obs) => obs, parallel))
          // Subscribe to collect results of individual calls as they arrive
          .subscribe({
            // Each time an observable finishes, a success or error result is pushed to the results Array
            next: (result) => updateResults.push(result),
            // When all observables are finished, the final results array is emitted
            complete: () => {
              setTimeout(() => {
                let successCount = 0,
                  errorCount = 0;
                // Each result in the set is analyzed and added to the logs
                updateResults.forEach((res) => {
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
                // Generate results summary
                this.resultsSummary = this.translate.instant(
                  "Main.ResultsSummary",
                  { successCount, errorCount },
                );
                this.running = false;
              }, 500);
            },
          });
      
        return of(updateResults);
    }
    


  /* *** Methods group 4: CSV parsing and prechecks *** */
  // Initial CSV validation: verifies if all fields defined in the profile are present in the CSV - based on preview parse to limit processing time
  validateCSV(file: File) {
    console.log("Entering CSV preview method");
    let preview: ParseResult = this.papa.parse(file, {
      header: true,
      preview: 3,
      skipEmptyLines: "greedy",
    });

    let missingFields: string[] = this.CheckCSV(preview, this.selectedProfile);
    console.log("Finished CSV match verification with result: ", missingFields);
    if (missingFields.length > 0) {
      console.error(
        "CSV file has missing fields: ",
        this.missingFields.join(", "),
      );
      this.hasErrors.push(
        `CSV file has missing fields: ${this.missingFields.join(", ")}`,
      );
      return false;
    }
    return true;
  }

  // Parse CSV: parses the full CSV file - returns raw CSV parse output, no additional processing applied
  parseCSV(file: File): ParseResult {
    console.log("Entering CSV full parse method");
    let parsedCSV: ParseResult = this.papa.parse(file, {
      header: true,
      //complete: this.parsed,
      skipEmptyLines: "greedy",
    });

    if (parsedCSV.errors.length > 0) {
      console.warn("Errors:", parsedCSV.errors);
      this.hasErrors.push(
        ...parsedCSV.errors.map(
          (e) => `${e.code} on row ${e.row + 1}: ${e.message}`,
        ),
      );
    }

    console.log("Finished CSV full parse method");
    return parsedCSV;
  }

  // Compares CSV header from parseResult with the field list of a specific profile
  private CheckCSV(result: ParseResult, selectedProfile: Profile): string[] {
    let missing: string[] = [];
    selectedProfile.fields.forEach((f) => {
      if (f.header !== "" && !result.meta.fields.includes(f.header)) {
        missing.push(f.header);
      }
    });
    return missing;
  }

  // Add line to results log
  private log = (str: string) => (this.results += `${str}\n`);

  // Main method to start import action

  private parsed = async (result: ParseResult) => {
    this.missingFields = this.CheckCSV(result, this.selectedProfile);
    if (this.missingFields.length > 0) {
      console.error(
        "CSV file has missing fields: ",
        this.missingFields.join(", "),
      );
    }

    if (result.errors.length > 0) {
      console.warn("Errors:", result.errors);
    }

    console.log("Starting user mapping procedure");
    let users: any[] = result.data.map((row) =>
        this.userService.buildCsvUser(row, this.selectedProfile),
      ),
      results: string[] = [];
    console.log("Finished parsing csv users: ", users);

    

    console.log("Setting parallel call number");
    /* Generation of primary ID is not thread safe; only parallelize if primary ID is supplied */
    const parallel = users.every((user) => user.primary_id)
      ? MAX_PARALLEL_CALLS
      : 1;
    console.log("Opening confirmation dialog");
    this.dialogs
      .confirm({
        text: [
          "Main.ConfirmCreateUsers",
          { count: users.length, type: this.selectedProfile.profileType },
        ],
      })
      .subscribe((result) => {
        if (!result) {
          this.results = "";
          return;
        }
        this.recordsToProcess = users.length;
        this.running = true;
        console.log("Right before processing starts");

        // Loop over users array and turn each into an observable that calls the processing method
        // The result is an array of observables (which are not yet doing anything)
        from(
          users.map((user) =>
            this.userService
              .processCustomUser(user, this.selectedProfile.profileType)
              .pipe(tap(() => this.processed++)),
          ),
        )
          // Run the user processing with concurrency control, with parallel controlling how many calls are performed at the same time
          .pipe(mergeMap((obs) => obs, parallel))
          // Subscribe to collect results of individual calls as they arrive
          .subscribe({
            // Each time an observable finishes, a success or error result is pushed to the results Array
            next: (result) => results.push(result),
            // When all observables are finished, the final results array is emitted
            complete: () => {
              setTimeout(() => {
                let successCount = 0,
                  errorCount = 0;
                // Each result in the set is analyzed and added to the logs
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
                // Generate results summary
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
