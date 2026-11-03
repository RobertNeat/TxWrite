import { Component, computed, input, output } from '@angular/core';
import { isTextFile } from '../file-tree/file-tree.model.js';
import { buildOutline } from './outline.model.js';
import type { JumpTarget } from '../editor/editor.component.js';

@Component({
  selector: 'app-outline',
  standalone: true,
  templateUrl: './outline.component.html',
  styleUrl: './outline.component.css',
})
export class OutlineComponent {
  readonly path = input<string | null>(null);
  readonly content = input<string | null>(null);
  readonly jump = output<JumpTarget>();

  protected readonly isBinary = computed(() => {
    const path = this.path();
    return !!path && !isTextFile(path);
  });

  protected readonly items = computed(() => {
    const path = this.path();
    const content = this.content();
    if (!path || content === null || !isTextFile(path)) {
      return [];
    }
    return buildOutline(path, content);
  });

  protected selectItem(ln: number): void {
    const path = this.path();
    if (!path) {
      return;
    }
    this.jump.emit({ path, line: ln });
  }
}
