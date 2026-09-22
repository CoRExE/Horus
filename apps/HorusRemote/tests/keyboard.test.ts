import assert from 'node:assert/strict';
import test from 'node:test';
import { editKeyboardText } from '../services/keyboardEditing.ts';

test('la saisie insère au curseur, conserve accents et ponctuation, puis efface le caractère précédent', () => {
  let edit = editKeyboardText('Srie 2', 1, 'é');
  assert.deepEqual(edit, { value: 'Série 2', cursor: 2 });
  edit = editKeyboardText(edit.value, 7, ' : VF!');
  assert.deepEqual(edit, { value: 'Série 2 : VF!', cursor: 13 });
  edit = editKeyboardText(edit.value, edit.cursor, 'backspace');
  assert.deepEqual(edit, { value: 'Série 2 : VF', cursor: 12 });
  assert.deepEqual(editKeyboardText(edit.value, edit.cursor, 'clear'), { value: '', cursor: 0 });
});

test('curseur borné et suppression Unicode sans couper les caractères', () => {
  assert.deepEqual(editKeyboardText('A😀é', 2, 'backspace'), { value: 'Aé', cursor: 1 });
  assert.deepEqual(editKeyboardText('A😀é', 1, 'right'), { value: 'A😀é', cursor: 2 });
  assert.equal(editKeyboardText('ABC', 0, 'left').cursor, 0);
  assert.equal(editKeyboardText('ABC', 3, 'right').cursor, 3);
  assert.deepEqual(editKeyboardText('ABC', -10, 'backspace'), { value: 'ABC', cursor: 0 });
  assert.deepEqual(editKeyboardText('ABC', 100, 'é'), { value: 'ABCé', cursor: 4 });
});
