module.exports = ({ config }) => ({
  ...config,
  // The Android release pipeline opts out of EAS Update in the new native binary.
  // Existing Android development builds keep their current update configuration.
  ...(process.env.HORUS_ANDROID_RELEASE === '1'
    ? { updates: { ...config.updates, enabled: false } }
    : {}),
});
