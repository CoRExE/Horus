export const bytesLabel = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} Go`
    : `${Math.round(bytes / 1024 ** 2)} Mo`;
