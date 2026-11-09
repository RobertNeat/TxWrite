import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { StatusBarComponent } from './status-bar.component.js';
import { EventStreamService, type AppEvent } from '../../core/events/event-stream.service.js';

describe('StatusBarComponent (install/font status line)', () => {
  let fixture: ComponentFixture<StatusBarComponent>;
  let events$: Subject<AppEvent>;

  function emit(event: Partial<AppEvent> & { type: AppEvent['type'] }): void {
    events$.next({ timestamp: new Date().toISOString(), ...event });
    fixture.detectChanges();
  }

  function installText(): string | null {
    return fixture.nativeElement.querySelector('#status-bar-install')?.textContent?.trim() ?? null;
  }

  function pendingText(): string | null {
    return (
      fixture.nativeElement.querySelector('#status-bar-install-pending')?.textContent?.trim() ??
      null
    );
  }

  beforeEach(() => {
    events$ = new Subject<AppEvent>();
    vi.useFakeTimers();

    TestBed.configureTestingModule({
      imports: [StatusBarComponent],
      providers: [
        {
          provide: EventStreamService,
          useValue: {
            connect: vi.fn(),
            connected: () => false,
            events$: events$.asObservable(),
          },
        },
      ],
    });

    fixture = TestBed.createComponent(StatusBarComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an install.started event as a single line', () => {
    emit({ type: 'install.started', projectId: 'p1', payload: { packageName: 'tikz-cd' } });
    expect(installText()).toContain('tikz-cd');
  });

  it('clears the line automatically after the display duration', () => {
    emit({ type: 'font.resolved', projectId: 'p1', payload: { fontName: 'EB Garamond' } });
    expect(installText()).toContain('EB Garamond');

    vi.advanceTimersByTime(3_000);
    fixture.detectChanges();
    expect(installText()).toBeNull();
  });

  it('queues events that arrive while one is already showing, draining one at a time', () => {
    emit({ type: 'install.queued', projectId: 'p1', payload: { packageName: 'pkg-a' } });
    emit({ type: 'install.started', projectId: 'p1', payload: { packageName: 'pkg-a' } });
    emit({ type: 'install.finished', projectId: 'p1', payload: { packageName: 'pkg-a' } });

    // First message active, two queued behind it.
    expect(installText()).toContain('pkg-a');
    expect(pendingText()).toBe('+2');

    vi.advanceTimersByTime(3_000);
    fixture.detectChanges();
    expect(pendingText()).toBe('+1');

    vi.advanceTimersByTime(3_000);
    fixture.detectChanges();
    expect(pendingText()).toBeNull();

    vi.advanceTimersByTime(3_000);
    fixture.detectChanges();
    expect(installText()).toBeNull();
  });

  it('drops the oldest queued message once the cap is exceeded', () => {
    for (let i = 0; i < 7; i++) {
      emit({ type: 'install.queued', projectId: 'p1', payload: { packageName: `pkg-${i}` } });
    }
    // Cap is 5 pending messages behind the currently active one.
    expect(pendingText()).toBe('+5');
  });

  it('ignores install/font events for a different project', () => {
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.detectChanges();

    emit({
      type: 'install.started',
      projectId: 'p2',
      payload: { packageName: 'other-project-pkg' },
    });
    expect(installText()).toBeNull();
  });

  it('ignores unrelated event types (e.g. compile.started)', () => {
    emit({ type: 'compile.started', projectId: 'p1' });
    expect(installText()).toBeNull();
  });

  it('clears the queue when the project changes', () => {
    fixture.componentRef.setInput('projectId', 'p1');
    fixture.detectChanges();

    emit({ type: 'install.queued', projectId: 'p1', payload: { packageName: 'pkg-a' } });
    emit({ type: 'install.started', projectId: 'p1', payload: { packageName: 'pkg-a' } });
    expect(installText()).not.toBeNull();
    expect(pendingText()).toBe('+1');

    fixture.componentRef.setInput('projectId', 'p2');
    fixture.detectChanges();

    expect(installText()).toBeNull();
    expect(pendingText()).toBeNull();
  });
});
