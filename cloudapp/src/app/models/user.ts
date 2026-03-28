
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