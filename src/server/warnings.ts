let installed = false;

export function installWarningFilter(): void {
  if (installed) return;
  installed = true;
  process.on('warning', (warn) => {
    if (warn.name === 'ExperimentalWarning' && warn.message.includes('SQLite')) return;
    console.warn(warn.stack ?? warn.toString());
  });
}

installWarningFilter();
