// Jest setup for TaskFlow tests
// Mock grist API
global.grist = {
  docApi: {
    broadcast: () => {}
  },
  widgetApi: {
    setOptions: () => {}
  },
  onOptions: () => {}
};

// Mock document if needed
if (typeof document === 'undefined') {
  global.document = {
    createElement: () => ({
      innerHTML: '',
      querySelector: () => null,
      querySelectorAll: () => [],
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      style: { display: '' }
    })
  };
}
