import { Pipe } from '@angular/core';
import type { PipeTransform } from '@angular/core';

@Pipe({
  name: 'formatMs',
  standalone: true
})
export class FormatMsPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value == null || Number.isNaN(value)) {
      return '';
    }
    const totalSeconds = Math.max(0, Math.floor(value / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ':' + seconds.toString().padStart(2, '0');
  }
}
