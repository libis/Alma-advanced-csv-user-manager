import { Injectable } from "@angular/core";
import {
  CloudAppRestService,
  HttpMethod,
  RestErrorResponse,
} from "@exlibris/exl-cloudapp-angular-lib";
import { EMPTY, Observable, of } from "rxjs";
import { catchError, switchMap, map, expand, reduce } from "rxjs/operators";
import { Field, Profile } from "../models/settings";
import * as dot from "dot-object";
import { ARRAY_INDICATOR, COMPOSITE_FIELDS } from "../models/settings-utils";

export interface UserResponse {
  user: any[],
  total_record_count: number
}

@Injectable({
  providedIn: "root",
})
export class UserService {
  private readonly PAGE_SIZE: number = 100;

  constructor(private restService: CloudAppRestService) {}

  // *** Method Group 1: General use methods
  private checkRepeatableField(fieldName: string): boolean {
    return ARRAY_INDICATOR.test(fieldName);
  }

  private handleError(e: RestErrorResponse, user: any) {
    const props = ["primary_id", "last_name", "first_name"].map((p) => user[p]);
    if (user) {
      e.message = e.message + ` (${props.join(", ")})`;
    }
    return e;
  }

  // *** Method Group 2: API actions
  // Collect full user set
  getAllUsers(): Observable<any[]> {

    const getUsersPage = (offset: number) =>
      this.restService.call<UserResponse>({
        url: `users?offset=${offset.toString()}&limit=${this.PAGE_SIZE.toString()}&expand=full`,
        method: HttpMethod.GET
      });

    return getUsersPage(0).pipe(

      // Recursively load additional pages
      expand((response, index) => {
        const nextOffset = (index + 1) * this.PAGE_SIZE;

        return nextOffset < response.total_record_count
          ? getUsersPage(nextOffset)
          : EMPTY;
      }),

      // Extract just the user arrays
      map(response => response.user),

      // Merge all pages into one array
      reduce(
        (allUsers, users) => [...allUsers, ...users],
        [] as any[]
      )
    );
  }

  // Get user account - if the user is not found, the method returns null
  private getUser(user: any) {
    return this.restService.call(`/users/${user.primary_id}`).pipe(
      catchError((e) => {
        if (
          e.error &&
          e.error.errorList &&
          e.error.errorList.error[0].errorCode == "401861"
        ) {
          return of(null);
        } else {
          throw e;
        }
      }),
    );
  }

  // Add a new user
  private createUser(user: any) {
    return this.restService
      .call({
        url: "/users",
        method: HttpMethod.POST,
        requestBody: user,
      })
      .pipe(catchError((e) => of(this.handleError(e, user))));
  }

  private updateUser(user: any) {
    return this.restService
      .call({
        url: `/users/${user.primary_id}`,
        method: HttpMethod.PUT,
        requestBody: user,
      })
      .pipe(catchError((e) => of(this.handleError(e, user))));
  }

  private deleteUser(user: any) {
    return this.restService
      .call({
        url: `/users/${user.primary_id}`,
        method: HttpMethod.DELETE,
      })
      .pipe(
        map(() => ({ primary_id: user.primary_id })),
        catchError((e) => of(this.handleError(e, user))),
      );
  }

public processCustomUser(user: any, profileType: string) {
    switch (profileType) {
      case "ADD":
        return this.restService
          .call({
            url: "/users",
            method: HttpMethod.POST,
            requestBody: user['ADD'],
          })
          .pipe(catchError((e) => of(this.handleError(e, user['ADD']))));
      //case "ENRICH": // Deprecated due to extension update configuration functionality
      case "UPDATE":
        return this.restService.call(`/users/${user.primary_id}`).pipe(
          catchError((e) => {
            if (
              e.error &&
              e.error.errorList &&
              e.error.errorList.error[0].errorCode == "401861"
            ) {
              return of(null);
            } else {
              throw e;
            }
          }),
          switchMap((original) => {
            if (original == null) {
              return this.restService.call({
                url: "/users",
                method: HttpMethod.POST,
                requestBody: user['ADD'],
              });
            } else {
              this.calcUpdatedUser(original, user);
              delete original["user_role"];             
              return this.restService.call({
                url: `/users/${user.primary_id}`,
                method: HttpMethod.PUT,
                requestBody: original,
              });
          }
          }),
          catchError((e) => of(this.handleError(e, user))),
    );
      case "DELETE":
        return this.restService
          .call({
            url: `/users/${user.primary_id}`,
            method: HttpMethod.DELETE,
          })
          .pipe(
            map(() => ({ primary_id: user.primary_id })),
            catchError((e) => of(this.handleError(e, user))),
          );
      default:
        return of({primary_id: user.primary_id});
    }
  }

  // *** Method Group 3: User parsing methods

  // Build user objects based on csv user input
  public buildCsvUser(user: { [key: string]: string }, selectedProfile: Profile): any {
    let csvUser = {'primary_id':undefined};
    if(selectedProfile.fields.find(f => f.fieldName === 'primary_id') !== undefined){
      csvUser.primary_id = user[selectedProfile.fields.find(f => f.fieldName === 'primary_id').header].toLowerCase();
    }

    // If profile includes create option, add create objects
    if (["ADD", "UPDATE"].includes(selectedProfile.profileType)) {
      // Create basic user object using all fields defined in the profile
      let newUser = this.parseCsvFields(user, selectedProfile.fields);

      // Add general settings
      newUser["account_type"] = { value: selectedProfile.accountType };

      // Apply postprocessing to contact details
      /* Preferred address, email, phone */
      if (newUser["contact_info"]) {
        if (
          Array.isArray(newUser["contact_info"]["address"]) &&
          newUser["contact_info"]["address"].length > 0
        )
          newUser["contact_info"]["address"][0]["preferred"] = true;
        if (
          Array.isArray(newUser["contact_info"]["email"]) &&
          newUser["contact_info"]["email"].length > 0
        )
          newUser["contact_info"]["email"][0]["preferred"] = true;
        if (
          Array.isArray(newUser["contact_info"]["phone"]) &&
          newUser["contact_info"]["phone"].length > 0
        ) {
          newUser["contact_info"]["phone"][0]["preferred"] = true;
          newUser["contact_info"]["phone"][0]["preferred_sms"] = true;
        }
      }
      csvUser["ADD"] = newUser;
    }

    // If profile includes update options, add update and enrich objects
    if (["UPDATE", "ENRICH"].includes(selectedProfile.profileType)) {
      csvUser["REPLACE"] = this.parseCsvFields(user,selectedProfile.fields.filter((f) => f.swap === "REPLACE"));

      csvUser["ENRICH"] = this.parseCsvFields(user,selectedProfile.fields.filter((f) => f.swap === "ENRICH"));
    }
 
    return csvUser;
  }

  // Build base user containing only csv fields
  private parseCsvFields(user: { [key: string]: string }, fieldset: Field[]) {
    let parsedUser = {};
    fieldset.forEach((f) => {
      let fieldName = f.fieldName;

      // Parse fieldname for repeatable fields - the method will automatically calculate the correct array index
      if (ARRAY_INDICATOR.test(fieldName)) {
        fieldName = fieldName.replace(
          ARRAY_INDICATOR,
          `[${Object.keys(parsedUser).filter((k) => k.replace(ARRAY_INDICATOR, "[]") === fieldName).length}]`,
        );
      }

      // Process fields. If a csv column is identified, values from this column are used. Else, if a default is defined, the default value is used.
      if (f.header !== "" && user[f.header] !== "") {
        if(f.fieldName == 'primary_id'){
          user[f.header] = user[f.header].toLowerCase();
        }
        parsedUser[fieldName] = user[f.header];
      } else if (f.default !== "") {
        parsedUser[fieldName] = f.default;
      } else {
        parsedUser[fieldName] = "";
      }
    });

    // After all fields are parsed, turn into regular Javascript object and return
    return dot.object(parsedUser);
  }

  private calcUpdatedUser(origUser:any, csvUser: any){

    if('REPLACE' in csvUser){
    this.replaceUserFields(origUser, csvUser['REPLACE']);
    }

    if('ENRICH' in csvUser){
      this.enrichUserFields(origUser, csvUser['ENRICH']);
    }
  }

  private replaceUserFields(origUser: any, replaceUser: any){
    Object.keys(replaceUser).forEach((f) => {
      // Use switch to manage custom field updates for specialized fields
      switch (f) {
        case "contact_info":
          // Add empty object for contact info if not present in current user
          if (!("contact_info" in origUser)) {
            origUser["contact_info"] = {};
          }
          Object.keys(replaceUser["contact_info"]).forEach((s) => {
            origUser["contact_info"][s] = replaceUser["contact_info"][s];
          });

        default:
          // Default strategy = replace complete element
          origUser[f] = replaceUser[f];
      }
    });
  }

  // Method to enrich - this update strategy can only be set on repeatable fields in the profile configuration
  private enrichUserFields(origUser: any, enrichUser: any) {
    Object.keys(enrichUser).forEach((f) => {
      // Use switch to manage custom field updates for specialized fields
      switch (f) {
        case "contact_info":
          // Add empty object for contact info if not present in current user
          if (!("contact_info" in origUser)) {
            origUser["contact_info"] = {};
          }
          Object.keys(enrichUser["contact_info"]).forEach((s) => {
            if(!(s in origUser['contact_info'])){
              origUser["contact_info"][s] = [];
            }
            this.enrichRepeatableElement(enrichUser["contact_info"][s], origUser["contact_info"][s]);
          });

        default:
          // Default strategy = replace complete element
          this.enrichRepeatableElement(enrichUser[f], origUser[f]);
      }
    });
  }

  // Copied from original Cloud App
  private enrichRepeatableElement(originalElements, newElements) {
    // This function will copy any of the originalElements into the newElements, thereby
    // adding repeatable elements. Thus, when the PUT happens, the "swap all" will include both
    // old and new repeatables.
    if (originalElements && newElements) {
      for (let i = 0; i < originalElements.length; i++) {
        newElements.splice(newElements.length, 0, originalElements[i]);
      }
    }
  }  
}
