// Cursor offsets use Unicode code points, avoiding half a surrogate pair on deletion.
export function editKeyboardText(value: string, cursor: number, key: string) {
  const characters = Array.from(value);
  const position = Math.max(0, Math.min(cursor, characters.length));
  if (key === 'left') return { value, cursor: Math.max(0, position - 1) };
  if (key === 'right') return { value, cursor: Math.min(characters.length, position + 1) };
  if (key === 'clear') return { value: '', cursor: 0 };
  if (key === 'backspace') {
    if (!position) return { value, cursor: position };
    characters.splice(position - 1, 1);
    return { value: characters.join(''), cursor: position - 1 };
  }
  characters.splice(position, 0, ...Array.from(key));
  return { value: characters.join(''), cursor: position + Array.from(key).length };
}
