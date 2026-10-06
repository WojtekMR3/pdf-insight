type TextFragment = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};

/** Rebuild words without inserting spaces before separately encoded Polish diacritics. */
export function reconstructText(items: TextFragment[]): string {
  let output = '';
  let previous: TextFragment | undefined;
  for (const item of items) {
    if (!item.str && !item.hasEOL) continue;
    if (previous && output && !output.endsWith('\n')) {
      const sameLine =
        Math.abs(item.transform[5] - previous.transform[5]) < Math.max(2, item.height * 0.25);
      const gap = item.transform[4] - (previous.transform[4] + previous.width);
      if (!sameLine) output += '\n';
      else if (
        gap > Math.max(1.2, item.height * 0.15) &&
        !/\s$/.test(output) &&
        !/^\s/.test(item.str)
      )
        output += ' ';
    }
    output += item.str;
    if (item.hasEOL && !output.endsWith('\n')) output += '\n';
    previous = item;
  }
  return output
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
