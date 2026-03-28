import { Injectable } from "@angular/core";
import {
  CloudAppRestService,
  HttpMethod,
  RestErrorResponse,
} from "@exlibris/exl-cloudapp-angular-lib";
import { of } from "rxjs";
import { catchError, switchMap, map } from "rxjs/operators";
import { Field, Profile } from "../models/settings";
import * as dot from "dot-object";
import { ARRAY_INDICATOR, COMPOSITE_FIELDS } from "../models/settings-utils";

@Injectable({
  providedIn: "root",
})
export class UserService {
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
  private getAllUsers(profile: Profile): any[] {
    return [];
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
    console.log('Starting processUser method');
    switch (profileType) {
      case "ADD":
        console.log('Adding user: ', user['ADD']);
        //break;
        //return this.createUser(user);
        return this.restService
          .call({
            url: "/users",
            method: HttpMethod.POST,
            requestBody: user['ADD'],
          })
          .pipe(catchError((e) => of(this.handleError(e, user['ADD']))));
      //case "ENRICH": // Deprecated due to extension update configuration functionality
      case "UPDATE":
        //return this.getUser(user),
        console.log('Checking user base for user with primary ID: ', user.primary_id);
        return this.restService.call(`/users/${user.primary_id}`).pipe(
          catchError((e) => {
            if (
              e.error &&
              e.error.errorList &&
              e.error.errorList.error[0].errorCode == "401861"
            ) {
              console.log('No user found');
              return of(null);
            } else {
              console.error('Error collecting user');
              throw e;
            }
          }),
          switchMap((original) => {
            if (original == null) {
                console.log('Adding user: ', user['ADD']);
              return this.restService.call({
                url: "/users",
                method: HttpMethod.POST,
                requestBody: user['ADD'],
              });
            } else {
              console.log('Calculating updated user for user: ', original);
              this.calcUpdatedUser(original, user);
              //delete original["user_role"]; // Don't update roles = no longer needed, complete user is collected and merged
              console.log('Performing update for user with updated user object: ', original);
              
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
    }
  }


  // *** Method Group 3: User parsing methods

  // Build user objects based on csv user input
  public buildCsvUser(user: { [key: string]: string }, selectedProfile: Profile): any {
    console.log('Starting csv User build with user: ', user);
    let csvUser = {'primary_id':undefined};
    if(selectedProfile.fields.find(f => f.fieldName === 'primary_id') !== undefined){
      csvUser.primary_id = user[selectedProfile.fields.find(f => f.fieldName === 'primary_id').header];
    }

    // If profile includes create option, add create objects
    if (["ADD", "UPDATE"].includes(selectedProfile.profileType)) {
      console.log('Create add user for fields: ', selectedProfile.fields);
      // Create basic user object using all fields defined in the profile
      let newUser = this.parseCsvFields(user, selectedProfile.fields);
      console.log('Generated base user: ', newUser);

      // Add general settings
      newUser["account_type"] = { value: selectedProfile.accountType };
      console.log('Add general info to user: ', newUser);

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
      console.log('Finished processing csv user for add-action: ', csvUser);
    }

    // If profile includes update options, add update and enrich objects
    if (["UPDATE", "ENRICH"].includes(selectedProfile.profileType)) {
      console.log('Detected update action for user: ', user);
      csvUser["REPLACE"] = this.parseCsvFields(user,selectedProfile.fields.filter((f) => f.swap === "REPLACE"));
      console.log('Generating replace object for fields: ', selectedProfile.fields.filter((f) => f.swap === "REPLACE"))
      csvUser["ENRICH"] = this.parseCsvFields(user,selectedProfile.fields.filter((f) => f.swap === "ENRICH"));
      console.log('Generating enrich object for fields: ', selectedProfile.fields.filter((f) => f.swap === "ENRICH"))
    }

    // // If profile includes delete option, add delete object (PatronID only)
    // if (["DELETE"].includes(selectedProfile.profileType)) {
    //   console.log('Detected delete action for user: ', user);
    //   csvUser["DELETE"] = this.parseCsvFields(user,selectedProfile.fields.filter((f) => f.fieldName === "primary_id"));
    //   console.log('Generating delete object for fields: ', selectedProfile.fields.filter((f) => f.fieldName === "primary_id"));
    // }
    console.log('Finalized csv user: ', csvUser);
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
        parsedUser[fieldName] = user[f.header];
      } else if (f.default !== "") {
        console.log("No csv field found - using default: ", f.default);
        parsedUser[fieldName] = f.default;
      } else {
        parsedUser[fieldName] = "";
      }
    });

    // After all fields are parsed, turn into regular Javascript object and return
    return dot.object(parsedUser);
  }

  private calcUpdatedUser(origUser:any, csvUser: any){
    console.log('Calculating updated user for user: ', origUser);
    if('REPLACE' in csvUser){
    this.replaceUserFields(origUser, csvUser['REPLACE']);
    }

    if('ENRICH' in csvUser){
      this.enrichUserFields(origUser, csvUser['ENRICH']);
    }

    console.log('Finalized updated user for user: ', origUser);
    console.log('Update user: ', origUser);
  }

  private replaceUserFields(origUser: any, replaceUser: any){
    console.log('Starting replace with replace user: ', replaceUser);
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

    console.log('Finalizing replace for user: ', origUser);
    //return origUser;
  }

  // Method to enrich - this update strategy can only be set on repeatable fields in the profile configuration
  private enrichUserFields(origUser: any, enrichUser: any) {
    console.log('Starting replace with replace user: ', enrichUser);
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
          this.enrichRepeatableElement(origUser[f], enrichUser[f]);
      }
    });

  console.log('Finalizing replace for user: ', origUser);
    //return origUser;
  }

  // Copied from original Cloud App
  private enrichMultiElement(originalElements, newElements) {
    console.log('Enriching repeatable element: ', newElements);
    // This function will copy any of the originalElements into the newElements, thereby
    // adding repeatable elements. Thus, when the PUT happens, the "swap all" will include both
    // old and new repeatables.
    if (originalElements && newElements) {
      for (let i = 0; i < originalElements.length; i++) {
        newElements.splice(newElements.length, 0, originalElements[i]);
      }
    }
  }

  // ************************************************************
  // Old methods
  processUser(user: any, profileType: string) {
    console.log('Starting processUser method');
    switch (profileType) {
      case "ADD":
        return this.restService
          .call({
            url: "/users",
            method: HttpMethod.POST,
            requestBody: user,
          })
          .pipe(catchError((e) => of(this.handleError(e, user))));
      case "UPDATE":
      case "ENRICH":
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
                requestBody: user,
              });
            } else {
              delete original["user_role"]; // Don't update roles
              if (profileType == "ENRICH") {
                this.enrichRepeatableElement(
                  original.user_identifier,
                  user.user_identifier,
                );
                this.enrichRepeatableElement(
                  original.user_note,
                  user.user_note,
                );
                this.enrichRepeatableElement(
                  original.proxy_for_user,
                  user.proxy_for_user,
                );
                this.enrichRepeatableElement(
                  original.user_statistic,
                  user.user_statistic,
                );
                if (user.contact_info) {
                  this.enrichRepeatableElement(
                    original.contact_info.address,
                    user.contact_info.address,
                  );
                  this.enrichRepeatableElement(
                    original.contact_info.phone,
                    user.contact_info.phone,
                  );
                  this.enrichRepeatableElement(
                    original.contact_info.email,
                    user.contact_info.email,
                  );
                }
                if (
                  !user.contact_info &&
                  (original.contact_info.address ||
                    original.contact_info.phone ||
                    original.contact_info.email)
                ) {
                  //No user.contact_info supplied; create empty to load with existing entries
                  user.contact_info = {};
                }
                if (
                  !user.contact_info.address &&
                  original.contact_info.address
                ) {
                  user.contact_info.address = [];
                  for (
                    let i = 0;
                    i < original.contact_info.address.length;
                    i++
                  ) {
                    user.contact_info.address.push(
                      original.contact_info.address[i],
                    );
                  }
                }
                if (!user.contact_info.phone && original.contact_info.phone) {
                  user.contact_info.phone = [];
                  for (let i = 0; i < original.contact_info.phone.length; i++) {
                    user.contact_info.phone.push(
                      original.contact_info.phone[i],
                    );
                  }
                }
                if (!user.contact_info.email && original.contact_info.email) {
                  user.contact_info.email = [];
                  for (let i = 0; i < original.contact_info.email.length; i++) {
                    user.contact_info.email.push(
                      original.contact_info.email[i],
                    );
                  }
                }
              }
              return this.restService.call({
                url: `/users/${user.primary_id}`,
                method: HttpMethod.PUT,
                requestBody: Object.assign(original, user),
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
    }
  }

  // Called right after loading and parsing CSV input
  mapUser = (user: any, selectedProfile: Profile) => {
    console.log('Starting mapUser method');
    console.log("User record from csv: ", user);
    let testUser = this.buildCsvUser(user, selectedProfile);
    console.log('Testing new user mapping: ', testUser);
    const arrayIndicator = new RegExp(/\[\d*\]/);
    /* Map CSV to user fields */
    console.log("Profile fields: ", selectedProfile.fields);
    /*CSV input user is reduced to set of k,v arrays */
    let obj = Object.entries<string>(user).reduce((a, [k, v]) => {
      let f = selectedProfile.fields.find((f) => f.header === k);
      if (f && f.fieldName && v) {
        let fieldName = f.fieldName;
        if (arrayIndicator.test(fieldName)) {
          // array field
          //console.log('Parsed key: ', k.replace(arrayIndicator,'[]'));
          fieldName = fieldName.replace(
            arrayIndicator,
            `[${Object.keys(a).filter((k) => k.replace(arrayIndicator, "[]") === fieldName).length}]`,
          );
        }
        a[fieldName] = ["true", "false"].includes(v) ? v === "true" : v;
      }
      return a;
    }, {});
    /* Default values */
    let occurances = {};
    selectedProfile.fields
      .filter((f) => f.default)
      .forEach((f) => {
        occurances[f.fieldName] =
          (occurances[f.fieldName] == undefined
            ? -1
            : occurances[f.fieldName]) + 1;
        let name = f.fieldName.replace(/\[\]/g, `[${occurances[f.fieldName]}]`);
        if (!obj[name]) obj[name] = f.default;
      });
    obj = dot.object(obj);
    /* Preferred address, email, phone */
    if (obj["contact_info"]) {
      if (
        Array.isArray(obj["contact_info"]["address"]) &&
        obj["contact_info"]["address"].length > 0
      )
        obj["contact_info"]["address"][0]["preferred"] = true;
      if (
        Array.isArray(obj["contact_info"]["email"]) &&
        obj["contact_info"]["email"].length > 0
      )
        obj["contact_info"]["email"][0]["preferred"] = true;
      if (
        Array.isArray(obj["contact_info"]["phone"]) &&
        obj["contact_info"]["phone"].length > 0
      ) {
        obj["contact_info"]["phone"][0]["preferred"] = true;
        obj["contact_info"]["phone"][0]["preferred_sms"] = true;
      }
    }
    /* Account Type */
    obj["account_type"] = { value: selectedProfile.accountType };

    return obj;
  };

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
