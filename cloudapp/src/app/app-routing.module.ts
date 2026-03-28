import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { MainComponent, MainGuard } from './main/main.component';
import { ConfigComponent, ConfigGuard } from './settings/config.component';

const routes: Routes = [
  { path: '', component: MainComponent, canActivate: [MainGuard]},
  { path: 'config', component: ConfigComponent, canDeactivate: [ConfigGuard] },
];

@NgModule({
  imports: [RouterModule.forRoot(routes, {useHash: true})],
  exports: [RouterModule]
})
export class AppRoutingModule { }
