import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api/api.service.js';
import { I18nService } from '../../core/i18n/i18n.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';
import type { Profile } from '../../core/api/api.types.js';

@Component({
  selector: 'app-profile-picker',
  standalone: true,
  imports: [FormsModule, TranslatePipe],
  template: `
    <div id="profile-picker" class="profile-picker">
      <h1 id="profile-picker-title">{{ 'profile.pick' | t }}</h1>

      @if (profiles().length === 0) {
        <p id="profile-picker-empty">{{ 'profile.none' | t }}</p>
      }

      <ul id="profile-list">
        @for (profile of profiles(); track profile.id) {
          <li [id]="'profile-list-item-' + profile.id" class="profile-list-item">
            <button [id]="'profile-select-' + profile.id" type="button" (click)="select(profile)">
              {{ profile.displayName }}
            </button>
          </li>
        }
      </ul>

      <form id="profile-create-form" (ngSubmit)="create()">
        <input
          id="profile-create-name"
          name="displayName"
          type="text"
          [(ngModel)]="newDisplayName"
          [placeholder]="'profile.name' | t"
          required
        />
        <button id="profile-create-submit" type="submit">
          {{ 'profile.create' | t }}
        </button>
      </form>
    </div>
  `,
  styles: [
    `
      .profile-picker {
        padding: 2rem;
        max-width: 24rem;
        margin: 0 auto;
      }
      #profile-list {
        list-style: none;
        padding: 0;
      }
      .profile-list-item button {
        width: 100%;
        text-align: left;
        padding: 0.5rem;
        margin-bottom: 0.25rem;
      }
    `,
  ],
})
export class ProfilePickerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18nService);

  protected readonly profiles = signal<Profile[]>([]);
  protected newDisplayName = '';

  async ngOnInit(): Promise<void> {
    this.profiles.set(await this.api.listProfiles());
  }

  select(profile: Profile): void {
    void this.router.navigate(['/profiles', profile.id, 'projects']);
  }

  async create(): Promise<void> {
    const name = this.newDisplayName.trim();
    if (!name) {
      return;
    }
    const profile = await this.api.createProfile(name);
    this.newDisplayName = '';
    this.profiles.update((list) => [...list, profile]);
    this.select(profile);
  }
}
