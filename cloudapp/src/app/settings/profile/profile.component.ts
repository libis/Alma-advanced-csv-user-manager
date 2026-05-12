import { Component, OnInit, ViewChild, Input, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormArray, FormGroup, FormControl } from '@angular/forms';
import { MatTableDataSource, MatTable } from '@angular/material/table';
import { ARRAY_INDICATOR } from '../../models/settings-utils';

@Component({
  selector: 'app-settings-profile',
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileComponent implements OnInit {
  displayedColumns = {
    'Base': ['header', 'default', 'name','actions'],
    'Update': ['header', 'default', 'name','swap','actions']
  };
  dataSource: MatTableDataSource<any>;
  @ViewChild('table') table: MatTable<any>;
  @Input() form: FormGroup;
  
  constructor(private fb: FormBuilder) { }

  ngOnInit() {
    this.dataSource = new MatTableDataSource(this.fields.controls);
  }  

  addField() {
    this.fields.push(this.fb.group({header: '', fieldName: '', default: '', swap: 'KEEP'}));
    this.fields.markAsDirty();
    this.table.renderRows();
  }

  removeField(index: number) {
    this.fields.removeAt(index);
    this.fields.markAsDirty();
    this.table.renderRows();
  }

  get fields() { return this.form ? (this.form.get('fields') as FormArray) : new FormArray([])}
  get accountType() { return this.form ? (this.form.get('accountType') as FormControl) : new FormControl('')}
  get profileType() { return this.form ? (this.form.get('profileType') as FormControl) : new FormControl('')}
  get showColumns() {return ['UPDATE', 'SYNC'].includes(this.profileType.value) ? this.displayedColumns['Update']: this.displayedColumns['Base']}
}