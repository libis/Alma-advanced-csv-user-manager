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
import { CsvUser, CsvAddUser, syncUser, CsvUpdateUser } from "../models/user";

export interface UserResponse {
  user: any[],
  total_record_count: number
}

export interface UpdateResult {
  //user: syncUser;
  success: boolean;
  data?: string;
  error?: RestErrorResponse;
}

const STRING_FIELDS = ['primary_id', 'first_name', 'middle_name', 'last_name', 'password', 'force_password_change', 'pref_first_name', 'pref_middle_name', 'pref_last_name', 'external_id', 'job_description', 'pin_number'];
const VALUE_FIELDS = ['account_type', 'user_group', 'campus_code', 'preferred_language', 'record_type', 'job_category', 'user_title', 'status'];
const STRING_LISTS = ['proxy_for_user'];
const DATE_FIELDS = ['birth_date', 'expiry_date', 'purge_date'];

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

  private handleError(e: RestErrorResponse, user: syncUser) {
    // Depending on the action type, return a coherent set of userdata
    if (user) {
    const user_props = [user.primary_id];
    if(user.ADD !== undefined && user.ADD.first_name && user.ADD.last_name){
      user_props.push(user.ADD.last_name);
      user_props.push(user.ADD.first_name);
    }
    
      e.message = e.message + ` (${user_props.join(", ")})`;
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
  // private getUser(user: any) {
  //   return this.restService.call(`/users/${user.primary_id}`).pipe(
  //     catchError((e) => {
  //       if (
  //         e.error &&
  //         e.error.errorList &&
  //         e.error.errorList.error[0].errorCode == "401861"
  //       ) {
  //         return of(null);
  //       } else {
  //         return of (e)
  //       }
  //     }),
  //   );
  // }

  // Single action method for ADD
  private createUser(user: syncUser) {
    return this.restService
      .call({
        url: "/users",
        method: HttpMethod.POST,
        requestBody: user['ADD'],
      })
      .pipe(
        map(
          (res) => ({success: true, action: 'create', data: res})
        ),
        catchError(
          (e) => of({success: false, action: 'create', error: this.handleError(e, user)})
        )
      );      
  }

  // Single action method for UPDATE
  private updateUser(user: syncUser, currUser: any) {
    this.calcUpdatedUser(currUser, user);
    delete currUser["user_role"];
    return this.restService
      .call({
        url: `/users/${user.primary_id}`,
        method: HttpMethod.PUT,
        requestBody: currUser,
      })
      .pipe(
        map(
          (res) => ({success: true, action: 'update', data: res})
        ),
        catchError(
          (e) => of({success: false, action: 'update', error: this.handleError(e, user)})
        )
      );
  }

  // Single action method for delete
  private deleteUser(user: syncUser) {
    return this.restService
      .call({
        url: `/users/${user.primary_id}`,
        method: HttpMethod.DELETE,
      })
      .pipe(
        map(
          // When successfull, the result is in practice null, as the delete action gives back no data (html-code 204)
          (res) => ({success: true, action: 'delete', data: {primary_id: user.primary_id}})
        ),
        catchError(
          (e) => of({success: false, action: 'delete', error: this.handleError(e, user)})
        )
      );
  }

public processSingleUser(user: syncUser, profileType: string, currUser: any|undefined = undefined){
switch (profileType) {
      case "ADD":
        return this.createUser(user);

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
              return this.createUser(user);
            } else {
              return this.updateUser(user, original);
            }
          }),
          catchError((e) => of({success: false, action: 'update', error: this.handleError(e, user)})),
    );
    case "SYNC":
          if (currUser == null) {
              return this.createUser(user);
            } else {
              return this.updateUser(user, currUser);
          }
      case "DELETE":
        return this.deleteUser(user);
      
      default:
          return of({success: false, action: 'unknown', error:{
            ok: false,
            status:'unknown',
            statusText:'unknown',
            message: 'Unknown profile type - could not perform action',
            error: 'Unknown profile type'
          }
        })
      }
}


public processCustomUser(user: syncUser, profileType: string, currUser: any|undefined = undefined) {
    switch (profileType) {
      case "ADD":
        return this.restService
          .call({
            url: "/users",
            method: HttpMethod.POST,
            requestBody: user['ADD'],
          })
          .pipe(
            catchError((e) => of(this.handleError(e, user))));
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
    case "SYNC":
          if (currUser == null) {
              return this.restService.call({
                url: "/users",
                method: HttpMethod.POST,
                requestBody: user['ADD'],
              }).pipe(
                catchError((e) => of(this.handleError(e, user)))  
              );
            } else {
              this.calcUpdatedUser(currUser, user);
              delete currUser["user_role"];
              return this.restService.call({
                url: `/users/${user.primary_id}`,
                method: HttpMethod.PUT,
                requestBody: currUser,
              }).pipe(
                catchError((e) => of(this.handleError(e, user)))  
              );
          }
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
          return of()
  }
}

// Verify if the user has meaningful updates. The method will return true as soon as a single updated field is found
 private triggerUpdate(user: any, currUser: any): boolean {

  if(user.REPLACE){
  Object.keys(user.REPLACE).forEach((key: string) => {

    switch(key){
      case STRING_FIELDS.includes(key):
        if(user.REPLACE[key] !== currUser[key]){
          return true;
      }
      break;

      case VALUE_FIELDS.includes(key):
        if(user.REPLACE[key].value !== currUser[key].value){
          return true;
        }
    }
  }
  );

  }
  }
}

  return false
 }




  // *** Method Group 3: User parsing methods

  // Build sync user objects. Input: unprocessed CSV row => Output: complete sync user matching profile requirements
  public buildCsvUser(user: { [key: string]: string }, selectedProfile: Profile): syncUser {
    // Initialize new syncUser. Primary ID is set to an empty string as initial value (~ use case: user creation with automated ID assignment)
    let csvUser: syncUser= {'primary_id':''};
    const id_column = selectedProfile.fields.find(f => f.fieldName === 'primary_id');
    if(id_column !== undefined && id_column.header in user){
      csvUser.primary_id = user[id_column.header].toLowerCase();
    }  

    // If profile includes create option, add create objects
    if (["ADD", "UPDATE"].includes(selectedProfile.profileType)) {
      // Create basic user object using all fields defined in the profile
      let newUser: CsvUser = this.parseCsvFields(user, selectedProfile.fields);

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
      csvUser["ADD"] = newUser as CsvAddUser;
    }

    // If profile includes update options, add update and enrich objects
    if (["UPDATE", "ENRICH"].includes(selectedProfile.profileType)) {
      csvUser["REPLACE"] = this.parseCsvFields(user,selectedProfile.fields.filter((f) => f.swap === "REPLACE")) as CsvUpdateUser;

      csvUser["ENRICH"] = this.parseCsvFields(user,selectedProfile.fields.filter((f) => f.swap === "ENRICH")) as CsvUpdateUser;
    }
 
    return csvUser;
  }

  // Build base user containing only csv fields. Input: unprocessed CSV row => Output: Basic CSVuser (no specific type)
  private parseCsvFields(user: { [key: string]: string }, fieldset: Field[]): CsvUser {
    let parsedUser: { [key: string]: string } = {};
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
        if(f.fieldName === 'primary_id'){
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
  private enrichRepeatableElement(originalElements: any, newElements: any) {
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
