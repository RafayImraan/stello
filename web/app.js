(() => {
  const connectButton = document.querySelector('#connect');
  const verifyButton = document.querySelector('#verify');
  const walletAddress = document.querySelector('#wallet-address');
  const networkStatus = document.querySelector('#network-status');
  const headerNetwork = document.querySelector('#header-network');
  const walletNetwork = document.querySelector('#wallet-network');
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
      notify('Wallet not detected. Allow Varial on this site in Chrome extensions, then refresh.');
      return;
    }

    connectButton.disabled = true;
    connectButton.textContent = 'Connecting…';
    try {
      if (wallet.isConnected) {
        const availability = await wallet.isConnected();
        if (availability.error) throw new Error(availability.error.message || 'Could not reach Freighter.');
        if (!availability.isConnected) {
          notify('Wallet unavailable. Allow Varial on this site in Chrome extensions, then refresh.');
          connectButton.textContent = 'Connect wallet';
          return;
        }
      }
      const network = await wallet.getNetwork();
      if (network.error) throw new Error(network.error.message || 'Could not read the wallet network.');
      const isTestnet = network.networkPassphrase === 'Test SDF Network ; September 2015' || network.network === 'TESTNET';
      const networkName = isTestnet ? 'Stellar Testnet' : network.network === 'PUBLIC' ? 'Stellar Mainnet' : network.network || 'Other Stellar network';
      headerNetwork.textContent = networkName;
      walletNetwork.textContent = networkName;
      networkStatus.classList.toggle('off-testnet', !isTestnet);
      if (!isTestnet) {
        walletAddress.textContent = 'Not connected';
        verifyButton.disabled = true;
        setupNote.textContent = `Varial is on ${networkName}. Switch it to Stellar Testnet before connecting.`;
        notify(`Switch Varial to Stellar Testnet first. Current network: ${networkName}.`);
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
      notify('Wallet connected on Stellar Testnet.');
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
