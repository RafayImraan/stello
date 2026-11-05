(() => {
  const connectButton = document.querySelector('#connect');
  const verifyButton = document.querySelector('#verify');
  const walletAddress = document.querySelector('#wallet-address');
  const setupNote = document.querySelector('#setup-note');
  const toast = document.querySelector('#toast');
  let toastTimer;

  function notify(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  }

  connectButton.addEventListener('click', async () => {
    const wallet = window.freighterApi;
    if (!wallet) {
      notify('Freighter wallet not found.');
      window.open('https://www.freighter.app/', '_blank', 'noopener,noreferrer');
      return;
    }

    connectButton.disabled = true;
    connectButton.textContent = 'Connecting…';
    try {
      if (wallet.isConnected) {
        const availability = await wallet.isConnected();
        if (availability.error) throw new Error(availability.error.message || 'Could not reach Freighter.');
        if (!availability.isConnected) {
          notify('Freighter is not available in this browser.');
          window.open('https://www.freighter.app/', '_blank', 'noopener,noreferrer');
          connectButton.textContent = 'Connect wallet';
          return;
        }
      }
      const network = await wallet.getNetwork();
      if (network.error) throw new Error(network.error.message || 'Could not read the wallet network.');
      if (network.network !== 'TESTNET') {
        notify('Switch Freighter to Stellar Testnet first.');
        connectButton.textContent = 'Connect wallet';
        return;
      }

      const result = await wallet.requestAccess();
      if (result.error) throw new Error(result.error.message || 'Wallet access denied.');
      const address = result.address;
      walletAddress.textContent = `${address.slice(0, 8)}…${address.slice(-6)}`;
      connectButton.textContent = `${address.slice(0, 5)}…${address.slice(-4)} ✓`;
      verifyButton.disabled = false;
      setupNote.textContent = 'Connect a deployed Stello verifier to submit a proof.';
      notify('Wallet connected.');
    } catch (error) {
      connectButton.textContent = 'Connect wallet';
      notify(error instanceof Error ? error.message : 'Could not connect wallet.');
    } finally {
      connectButton.disabled = false;
    }
  });

  verifyButton.addEventListener('click', () => {
    notify('Identity verification is not configured yet.');
  });
})();
