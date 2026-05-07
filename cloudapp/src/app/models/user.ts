
export class alma_user {
    "link"?: string;
    "record_type": value_object;
}

export class value_object {
    value: string;
    constructor(value: string){
        this.value = value;
    }
}

export interface syncUser {
    // Add user = general CSV user with selection of required fields
    primary_id: string;
    ADD?: CsvAddUser;
    // Replace and enrich user = general CSV user
    REPLACE?: CsvUpdateUser;
    ENRICH?: CsvUpdateUser;
 }

// Interface to represent any variant of a pre-processed CSV user
export interface CsvUser {
    account_type?: ValueCode;
    primary_id?: string;
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    contact_info?: ContactInfo;
    user_identifier?: UserIdentifier[];
    user_note?: UserNote[];
    user_statistic?: UserStatistic[];
    user_group?: ValueCode;
    campus_code?: ValueCode;
    preferred_language?: ValueCode;
    birth_date?: string;
    expiry_date?: string;
    purge_date?: string;
    password?: string;
    force_password_change?: string;
    pref_first_name?: string;
    pref_middle_name?: string;
    pref_last_name?: string;
    external_id?: string;
    record_type?: ValueCode;
    job_category?: ValueCode;
    job_description?: string;
    pin_number?: string;
    proxy_for_user?: string[];
    user_title?: ValueCode;
    status?: ValueCode;
    rs_library?: RSLibrary[]
}

type RequireFields<Type, Key extends keyof Type> =
  Omit<Type, Key> & Required<Pick<Type, Key>>;

// CSV User variant with minimal Alma fields as required fields
export type CsvAddUser = Omit<CsvUser, 'primary_id'|'first_name'|'last_name'|'user_group'>
& RequireFields<CsvUser, 'primary_id'|'first_name'|'last_name'|'user_group'>
& {contact_info: Omit<NonNullable<CsvUser['contact_info']>, 'email_address'>
& {email_address: AlmaEmail}
}

// CSV User variant with Patron ID as required field for update purposes
export type CsvUpdateUser = Omit<CsvUser, 'primary_id'> & RequireFields<CsvUser, 'primary_id'>

export interface TypedValue {
    type: ValueCode;
    value: string;
}

export interface ValueCode {
    value: string;
}

export interface ContactInfo {
    address?: AlmaAddress[];
    email?: AlmaEmail[];
    phone?: AlmaPhone[];
}

export interface AlmaAddress {
    line1?: string;
    line2?: string;
    line3?: string;
    line4?: string;
    line5?: string;
    city?: string;
    state_province?: string;
    postal_code?: string;
    country?: ValueCode;
    addresstype?: ValueCode[];
    preferred?: boolean;
}

export interface AlmaEmail {
    email_address: string;
    email_type: ValueCode[];
    preferred?: boolean;
}

export interface AlmaPhone {
    phone_number: string;
    phone_type: ValueCode[];
    preferred?: boolean;
    preferred_sms?:boolean;
}

export interface UserIdentifier {
    id_type: ValueCode;
    value: string;
    note?: string;
}

export interface UserNote {
    note_type: ValueCode;
    note_text: string;
    user_viewable?: string;
    popup_note?: string;
}

export interface UserStatistic {
    category_type: ValueCode;
    statistic_category: ValueCode;
}

export interface RSLibrary {
    code: ValueCode;
}