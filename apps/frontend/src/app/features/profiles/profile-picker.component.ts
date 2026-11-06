import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  OnInit,
  ViewChild,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api/api.service.js';
import { AuthService } from '../../core/auth/auth.service.js';
import { TranslatePipe } from '../../core/i18n/translate.pipe.js';
import { BrandComponent } from '../../shared/brand.component.js';
import { scrambleAll } from '../../shared/scramble.js';
import { placePopover } from '../../shared/popover-position.js';
import type { Profile, Project } from '../../core/api/api.types.js';

/** Ports app.js's PLACE: pre-login placeholder text for the blurred left panel. */
const PLACEHOLDER_PROFILE_NAME = 'Nazwa profilu';
const PLACEHOLDER_WORKSPACES = [
  'projekt-przykladowy',
  'notatki-wzor',
  'raport-szkic',
  'prezentacja-demo',
];

@Component({
  selector: 'app-profile-picker',
  standalone: true,
  imports: [FormsModule, TranslatePipe, BrandComponent],
  templateUrl: './profile-picker.component.html',
  styleUrl: './profile-picker.component.css',
})
export class ProfilePickerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly profiles = signal<Profile[]>([]);
  protected readonly projects = signal<Project[]>([]);
  protected readonly currentProfileId = signal<string | null>(null);
  protected readonly loggedIn = this.auth.isAuthenticated;
  protected readonly lastLogin = signal<Date | null>(null);

  protected readonly profilePopoverOpen = signal(false);
  protected readonly addingProfile = signal(false);
  protected readonly profileNameError = signal('');
  protected newProfileName = '';

  protected readonly kebabForProjectId = signal<string | null>(null);
  protected readonly renamingProjectId = signal<string | null>(null);
  protected renameValue = '';
  protected newWorkspaceName = '';
  protected readonly newWorkspaceError = signal('');

  protected readonly confirmDialog = signal<{
    title: string;
    body: string;
    onConfirm: () => void;
  } | null>(null);
  protected readonly toastMessage = signal('');
  private toastTimeout: ReturnType<typeof setTimeout> | null = null;

  protected readonly registerMode = signal(false);
  protected loginEmail = '';
  protected loginPassword = '';
  protected registerDisplayName = '';
  protected readonly loginPasswordVisible = signal(false);
  protected readonly loginEmailError = signal('');
  protected readonly loginPasswordError = signal('');
  protected readonly registerDisplayNameError = signal('');
  protected readonly loginFormError = signal('');
  protected readonly loggingIn = signal(false);
  protected readonly accountEmail = signal('');
  protected readonly accountName = signal('');

  @ViewChild('newWorkspaceInput') private newWorkspaceInput?: ElementRef<HTMLInputElement>;
  @ViewChild('lbody') private lbody?: ElementRef<HTMLElement>;
  @ViewChild('profBtn') private profBtn?: ElementRef<HTMLElement>;
  @ViewChild('profPop') private profPop?: ElementRef<HTMLElement>;
  private kebabButtons = new Map<string, HTMLElement>();

  protected registerKebabButton(projectId: string, el: HTMLElement): void {
    this.kebabButtons.set(projectId, el);
  }

  @HostListener('document:click')
  closeAllPopovers(): void {
    this.closeProfilePopover();
    this.closeKebab();
  }

  @HostListener('document:keydown.escape')
  handleEscape(): void {
    if (this.confirmDialog()) {
      return;
    }
    this.closeAllPopovers();
  }

  /** Replays app.js's scramble/decode effect on the left panel's .t text nodes. */
  private animateLeftPanelText(): void {
    afterNextRender(
      () => {
        if (this.lbody) {
          scrambleAll(this.lbody.nativeElement);
        }
      },
      { injector: this.injector },
    );
  }

  protected currentProfile(): Profile | null {
    const id = this.currentProfileId();
    return this.profiles().find((p) => p.id === id) ?? null;
  }

  protected currentProfileProjects(): Project[] {
    const id = this.currentProfileId();
    if (!id) {
      return [];
    }
    return this.projects().filter((p) => p.ownerProfileId === id);
  }

  /** Placeholder name/workspaces before login, real data after — matches app.js's locked-state rendering. */
  protected displayProfileName(): string {
    if (!this.loggedIn()) {
      return PLACEHOLDER_PROFILE_NAME;
    }
    return this.currentProfile()?.displayName ?? 'Brak profilu';
  }

  protected displayWorkspaceNames(): string[] {
    if (!this.loggedIn()) {
      return PLACEHOLDER_WORKSPACES;
    }
    return this.currentProfileProjects().map((p) => p.name);
  }

  protected totalProjectCount(): number {
    return this.projects().length;
  }

  /** Ports app.js's pl()/cnt(): Polish plural form for "N katalog/katalogi/katalogów". */
  protected workspaceCountLabel(profileId: string): string {
    const n = this.projects().filter((p) => p.ownerProfileId === profileId).length;
    const mod10 = n % 10;
    const mod100 = n % 100;
    const word =
      n === 1
        ? 'katalog'
        : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)
          ? 'katalogi'
          : 'katalogów';
    return `${n} ${word}`;
  }

  protected initials(name: string): string {
    const words = name
      .trim()
      .split(/[\s._-]+/)
      .filter(Boolean);
    const first = words[0]?.[0] ?? '?';
    const second = words.length > 1 ? words[1][0] : '';
    return (first + second).toUpperCase();
  }

  async ngOnInit(): Promise<void> {
    await this.auth.ready;
    if (this.auth.isAuthenticated()) {
      await this.loadWorkspace();
      this.animateLeftPanelText();
    }
  }

  private async loadWorkspace(): Promise<void> {
    const user = this.auth.currentUser();
    this.accountEmail.set(user?.email ?? '');
    this.accountName.set(user?.displayName ?? '');
    const [profiles, projects] = await Promise.all([
      this.api.listProfiles(),
      this.api.listProjects(),
    ]);
    this.profiles.set(profiles);
    this.projects.set(projects);
    this.currentProfileId.set(profiles[0]?.id ?? null);
  }

  // ---------- profile selection / popover ----------

  toggleProfilePopover(): void {
    if (this.profilePopoverOpen()) {
      this.closeProfilePopover();
    } else {
      this.profilePopoverOpen.set(true);
      this.addingProfile.set(false);
      this.profileNameError.set('');
      this.placeProfilePopover();
    }
  }

  private placeProfilePopover(): void {
    afterNextRender(
      () => {
        if (this.profPop && this.profBtn) {
          placePopover(this.profPop.nativeElement, this.profBtn.nativeElement, true);
        }
      },
      { injector: this.injector },
    );
  }

  closeProfilePopover(): void {
    this.profilePopoverOpen.set(false);
    this.addingProfile.set(false);
    this.profileNameError.set('');
  }

  selectProfile(profile: Profile): void {
    this.currentProfileId.set(profile.id);
    this.renamingProjectId.set(null);
    this.closeProfilePopover();
  }

  startAddProfile(): void {
    this.addingProfile.set(true);
    this.profileNameError.set('');
  }

  private validateName(name: string, existing: string[]): string {
    const trimmed = name.trim();
    if (!trimmed) {
      return 'Podaj nazwę.';
    }
    if (trimmed.length > 40) {
      return 'Nazwa może mieć najwyżej 40 znaków.';
    }
    if (/[\\/:*?"<>|]/.test(trimmed)) {
      return 'Nazwa nie może zawierać znaków: \\ / : * ? " < > |';
    }
    if (existing.some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      return 'Taka nazwa już istnieje.';
    }
    return '';
  }

  askDeleteProfile(profile: Profile): void {
    this.closeProfilePopover();
    this.confirmDialog.set({
      title: `Czy na pewno chcesz usunąć środowisko „${profile.displayName}”?`,
      body: `Zostanie usuniętych wraz z nim: ${this.workspaceCountLabel(profile.id)}. Tej operacji nie można cofnąć.`,
      onConfirm: () => void this.deleteProfile(profile),
    });
  }

  private async deleteProfile(profile: Profile): Promise<void> {
    await this.api.deleteProfile(profile.id);
    this.profiles.update((list) => list.filter((p) => p.id !== profile.id));
    this.projects.update((list) => list.filter((p) => p.ownerProfileId !== profile.id));
    if (this.currentProfileId() === profile.id) {
      this.currentProfileId.set(this.profiles()[0]?.id ?? null);
    }
    this.showToast(`Usunięto środowisko „${profile.displayName}”`);
  }

  async confirmAddProfile(): Promise<void> {
    const error = this.validateName(
      this.newProfileName,
      this.profiles().map((p) => p.displayName),
    );
    if (error) {
      this.profileNameError.set(error);
      return;
    }
    const profile = await this.api.createProfile(this.newProfileName.trim());
    this.profiles.update((list) => [...list, profile]);
    this.currentProfileId.set(profile.id);
    this.newProfileName = '';
    this.closeProfilePopover();
    this.showToast(`Dodano profil „${profile.displayName}”`);
  }

  // ---------- workspaces (projects) in the left panel ----------

  openKebab(projectId: string): void {
    const next = this.kebabForProjectId() === projectId ? null : projectId;
    this.kebabForProjectId.set(next);
    if (next) {
      afterNextRender(
        () => {
          const btn = this.kebabButtons.get(next);
          const pop = document.getElementById(`workspace-kebab-menu-${next}`);
          if (btn && pop) {
            placePopover(pop, btn, false);
          }
        },
        { injector: this.injector },
      );
    }
  }

  closeKebab(): void {
    this.kebabForProjectId.set(null);
  }

  exportZipUrl(project: Project): string {
    return this.api.exportZipUrl(project.id);
  }

  startRename(project: Project): void {
    this.closeKebab();
    this.renamingProjectId.set(project.id);
    this.renameValue = project.name;
  }

  cancelRename(): void {
    this.renamingProjectId.set(null);
  }

  async confirmRename(project: Project): Promise<void> {
    const siblings = this.currentProfileProjects()
      .filter((p) => p.id !== project.id)
      .map((p) => p.name);
    const error = this.validateName(this.renameValue, siblings);
    if (error) {
      this.showToast(error);
      return;
    }
    const name = this.renameValue.trim();
    const updated = await this.api.updateProject(project.id, { name });
    this.projects.update((list) => list.map((p) => (p.id === project.id ? updated : p)));
    this.renamingProjectId.set(null);
  }

  askDeleteProject(project: Project): void {
    this.closeKebab();
    this.confirmDialog.set({
      title: `Czy na pewno chcesz usunąć katalog roboczy „${project.name}”?`,
      body: 'Wszystkie pliki w tym katalogu zostaną usunięte. Tej operacji nie można cofnąć.',
      onConfirm: () => void this.deleteProject(project),
    });
  }

  private async deleteProject(project: Project): Promise<void> {
    await this.api.deleteProject(project.id);
    this.projects.update((list) => list.filter((p) => p.id !== project.id));
    this.showToast(`Usunięto katalog „${project.name}”`);
  }

  openProject(project: Project): void {
    void this.router.navigate(['/projects', project.id]);
  }

  async createWorkspace(): Promise<void> {
    const profile = this.currentProfile();
    if (!profile) {
      return;
    }
    const error = this.validateName(
      this.newWorkspaceName,
      this.currentProfileProjects().map((p) => p.name),
    );
    if (error) {
      this.newWorkspaceError.set(error);
      return;
    }
    const name = this.newWorkspaceName.trim();
    const project = await this.api.createProject({ name, ownerProfileId: profile.id });
    this.projects.update((list) => [...list, project]);
    this.newWorkspaceName = '';
    this.newWorkspaceError.set('');
    this.showToast(`Utworzono katalog „${name}”`);
    this.newWorkspaceInput?.nativeElement.focus();
  }

  clearWorkspaceError(): void {
    this.newWorkspaceError.set('');
  }

  async importZip(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so selecting the same file again still fires 'change'.
    input.value = '';
    const profile = this.currentProfile();
    if (!file || !profile) {
      return;
    }

    const baseName = file.name.replace(/\.zip$/i, '');
    const existing = this.currentProfileProjects().map((p) => p.name.toLowerCase());
    let name = baseName;
    let suffix = 2;
    while (existing.includes(name.toLowerCase())) {
      name = `${baseName}-${suffix}`;
      suffix++;
    }

    try {
      const project = await this.api.importProjectZip(name, profile.id, file);
      this.projects.update((list) => [...list, project]);
      this.showToast(`Zaimportowano katalog „${project.name}”`);
    } catch {
      this.showToast('Nie udało się zaimportować pliku ZIP.');
    }
  }

  // ---------- confirm dialog ----------

  closeDialog(): void {
    this.confirmDialog.set(null);
  }

  confirmDialogAction(): void {
    const dialog = this.confirmDialog();
    this.confirmDialog.set(null);
    dialog?.onConfirm();
  }

  // ---------- toast ----------

  private showToast(message: string): void {
    this.toastMessage.set(message);
    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
    this.toastTimeout = setTimeout(() => this.toastMessage.set(''), 3200);
  }

  // ---------- login / register (right panel) ----------

  togglePasswordVisibility(): void {
    this.loginPasswordVisible.update((v) => !v);
  }

  clearLoginEmailError(): void {
    this.loginEmailError.set('');
  }

  clearLoginPasswordError(): void {
    this.loginPasswordError.set('');
  }

  requestForgotPassword(): void {
    this.showToast('Odzyskiwanie hasła nie jest dostępne w tej wersji.');
  }

  switchToRegister(): void {
    this.registerMode.set(true);
    this.loginFormError.set('');
  }

  switchToLogin(): void {
    this.registerMode.set(false);
    this.loginFormError.set('');
  }

  private validateLoginForm(requireDisplayName: boolean): boolean {
    const email = this.loginEmail.trim();
    let ok = true;
    if (!email) {
      this.loginEmailError.set('Podaj adres e-mail.');
      ok = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.loginEmailError.set('Wpisz poprawny adres e-mail, np. imie@przyklad.pl.');
      ok = false;
    }
    if (!this.loginPassword) {
      this.loginPasswordError.set('Podaj hasło.');
      ok = false;
    } else if (requireDisplayName && this.loginPassword.length < 8) {
      this.loginPasswordError.set('Hasło musi mieć co najmniej 8 znaków.');
      ok = false;
    }
    if (requireDisplayName && !this.registerDisplayName.trim()) {
      this.registerDisplayNameError.set('Podaj nazwę wyświetlaną.');
      ok = false;
    }
    return ok;
  }

  async submitLogin(): Promise<void> {
    this.loginFormError.set('');
    if (!this.validateLoginForm(false)) {
      return;
    }
    this.loggingIn.set(true);
    try {
      await this.auth.login(this.loginEmail.trim(), this.loginPassword);
      await this.completeLogin();
    } catch (error) {
      this.loginFormError.set(
        error instanceof Error ? error.message : 'Logowanie nie powiodło się.',
      );
    } finally {
      this.loggingIn.set(false);
    }
  }

  async submitRegister(): Promise<void> {
    this.loginFormError.set('');
    this.registerDisplayNameError.set('');
    if (!this.validateLoginForm(true)) {
      return;
    }
    this.loggingIn.set(true);
    try {
      await this.auth.register(
        this.loginEmail.trim(),
        this.loginPassword,
        this.registerDisplayName.trim(),
      );
      await this.completeLogin();
    } catch (error) {
      this.loginFormError.set(
        error instanceof Error ? error.message : 'Rejestracja nie powiodła się.',
      );
    } finally {
      this.loggingIn.set(false);
    }
  }

  private async completeLogin(): Promise<void> {
    this.lastLogin.set(new Date());
    this.loginEmail = '';
    this.loginPassword = '';
    this.registerDisplayName = '';
    await this.loadWorkspace();
    this.animateLeftPanelText();
  }

  async logout(): Promise<void> {
    this.closeProfilePopover();
    await this.auth.logout();
    this.profiles.set([]);
    this.projects.set([]);
    this.currentProfileId.set(null);
    this.animateLeftPanelText();
  }

  formattedLastLogin(): string {
    const date = this.lastLogin();
    if (!date) {
      return '';
    }
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `dziś, ${hh}:${mm}`;
  }
}
