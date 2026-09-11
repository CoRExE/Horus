import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyArchitecture } from '../verify-desktop-files.mjs';

test('les contrôles Windows refusent les PE x86 et les en-têtes tronqués', () => {
  const pe = Buffer.alloc(128);
  pe.write('MZ');
  pe.writeUInt32LE(64, 0x3c);
  pe.write('PE\0\0', 64);
  pe.writeUInt16LE(0x8664, 68);
  pe.writeUInt16LE(0x20b, 88);
  assert.doesNotThrow(() => verifyArchitecture(pe, 'windows'));
  pe.writeUInt16LE(0x14c, 68);
  assert.throws(() => verifyArchitecture(pe, 'windows'), /x64/);
  assert.throws(() => verifyArchitecture(pe.subarray(0, 75), 'windows'), /x64/);
  pe.writeUInt32LE(0xffffffff, 0x3c);
  assert.throws(() => verifyArchitecture(pe, 'windows'), /x64/);
});

test('les contrôles Linux refusent ELF ARM64, 32 bits et les formats étrangers', () => {
  const elf = Buffer.alloc(64);
  elf.write('\x7fELF');
  elf[4] = 2;
  elf[5] = 1;
  elf.writeUInt16LE(62, 18);
  assert.doesNotThrow(() => verifyArchitecture(elf, 'linux'));
  elf.writeUInt16LE(183, 18);
  assert.throws(() => verifyArchitecture(elf, 'linux'), /x64/);
  elf.writeUInt16LE(62, 18);
  elf[4] = 1;
  assert.throws(() => verifyArchitecture(elf, 'linux'), /x64/);
  assert.throws(() => verifyArchitecture(Buffer.from('MZ'), 'linux'), /ELF/);
  assert.throws(() => verifyArchitecture(elf, 'unknown'), /inconnue/);
});
