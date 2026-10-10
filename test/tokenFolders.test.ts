import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetFolder, folderSize, groupByFolder, tokenFolder } from '../src/shared/tokenFolders.js';

describe('token folders', () => {
  it('nests people, shapes, and animals', () => {
    expect(tokenFolder('human male')).toBe('People/Humans');
    expect(tokenFolder('deep elf high priest')).toBe('People/Elves');
    expect(tokenFolder('spectral hydra 1')).toBe('Shapes/Spectral');
    expect(tokenFolder('giant ant')).toBe('Animals/Insects');
    expect(tokenFolder('iron giant')).toBe('Giants');
    expect(tokenFolder('zombie rat')).toBe('Undead/Zombies');
    expect(tokenFolder('asmodeus small')).toBe('Uniques');
    expect(tokenFolder('angel')).toBe('Celestials');
    expect(assetFolder({ name: 'angel', class: 'token', folder: 'People/Elves' })).toBe('People/Elves');
    expect(assetFolder({ name: 'angel', class: 'token' })).toBe('Celestials');
  });

  it('groups names into a sorted tree with Other last', () => {
    const tree = groupByFolder(
      [
        { name: 'elf mage' },
        { name: 'human' },
        { name: 'oddity' },
        { name: 'ant' },
      ],
      (item) => tokenFolder(item.name),
    );
    expect(tree.folders.map((folder) => folder.name)).toEqual(['Animals', 'People', 'Other']);
    const people = tree.folders.find((folder) => folder.name === 'People');
    expect(people?.folders.map((folder) => folder.name)).toEqual(['Elves', 'Humans']);
    expect(folderSize(people!)).toBe(2);
  });

  it('gives every bundled token a folder', () => {
    const names = readdirSync(join(process.cwd(), 'assets', 'tokens'))
      .filter((name) => /\.(png|jpe?g|gif|webp)$/i.test(name))
      .map((name) => name.replace(/\.[^.]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim());
    const other = names.filter((name) => tokenFolder(name) === 'Other').sort();
    expect(other, other.join('\n')).toEqual([]);
  });
});
