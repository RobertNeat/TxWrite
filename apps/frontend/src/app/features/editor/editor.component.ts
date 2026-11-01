import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';

@Component({
  selector: 'app-editor',
  standalone: true,
  template: `<div #host class="editor-host"></div>`,
  styles: [
    `
      :host,
      .editor-host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class EditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) private host!: ElementRef<HTMLElement>;

  private view: import('@codemirror/view').EditorView | null = null;

  async ngAfterViewInit(): Promise<void> {
    const [{ EditorView, basicSetup }, { markdown }] = await Promise.all([
      import('codemirror'),
      import('@codemirror/lang-markdown'),
    ]);

    this.view = new EditorView({
      doc: '% Start writing LaTeX or Markdown here\n',
      extensions: [basicSetup, markdown()],
      parent: this.host.nativeElement,
    });
  }

  ngOnDestroy(): void {
    this.view?.destroy();
  }
}
