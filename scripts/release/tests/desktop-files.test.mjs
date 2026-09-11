import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedTauriBinary, verifyArchitecture, verifyBinaryContents } from '../verify-desktop-files.mjs';

for (const [platform, marker] of [['windows', 'NSS'], ['linux', 'DEB']]) {
  test(`${platform} : seul le marqueur de packaging Tauri peut différer du build`, () => {
    const original = Buffer.from('prefix\0__TAURI_BUNDLE_TYPE_VAR_UNK\0payload');
    const installed = Buffer.from(`prefix\0__TAURI_BUNDLE_TYPE_VAR_${marker}\0payload`);
    assert.doesNotThrow(() => verifyBinaryContents(installed, original, platform));
    assert.equal(original.toString(), 'prefix\0__TAURI_BUNDLE_TYPE_VAR_UNK\0payload');
    assert.throws(() => verifyBinaryContents(original, original, platform), /différent/);
    const wrongType = Buffer.from('prefix\0__TAURI_BUNDLE_TYPE_VAR_MSI\0payload');
    assert.throws(() => verifyBinaryContents(wrongType, original, platform), /différent/);
    const tampered = Buffer.from(installed);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => verifyBinaryContents(tampered, original, platform), /différent/);
    assert.throws(() => verifyBinaryContents(installed.subarray(0, -1), original, platform), /différent/);
    assert.throws(() => verifyBinaryContents(Buffer.concat([installed, Buffer.from('extra')]), original, platform), /différent/);
  });
}

test('le contrôle reproduit uniquement le premier remplacement effectué par Tauri', () => {
  const built = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK\0__TAURI_BUNDLE_TYPE_VAR_UNK');
  const installed = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_DEB\0__TAURI_BUNDLE_TYPE_VAR_UNK');
  assert.doesNotThrow(() => verifyBinaryContents(installed, built, 'linux'));
  const twice = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_DEB\0__TAURI_BUNDLE_TYPE_VAR_DEB');
  assert.throws(() => verifyBinaryContents(twice, built, 'linux'), /différent/);
  assert.throws(() => expectedTauriBinary(Buffer.from('sans marqueur'), 'linux'), /absent/);
  assert.throws(() => expectedTauriBinary(built, 'unknown'), /inconnue/);
});

test('FFmpeg conserve une comparaison stricte sans normalisation du marqueur', () => {
  const original = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
  assert.doesNotThrow(() => verifyBinaryContents(Buffer.from(original), original));
  assert.throws(() => verifyBinaryContents(Buffer.from('__TAURI_BUNDLE_TYPE_VAR_DEB'), original), /différent/);
});

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
