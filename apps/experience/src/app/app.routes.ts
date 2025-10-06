import { Routes } from '@angular/router';

import { DocsComponent } from './docs/docs.component';
import { FaqComponent } from './faq/faq.component';
import { HomeComponent } from './home/home.component';
import { PlaygroundComponent } from './playground/playground.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'docs', component: DocsComponent },
  { path: 'playground', component: PlaygroundComponent },
  { path: 'faq', component: FaqComponent },
  { path: '**', redirectTo: '' }
];
