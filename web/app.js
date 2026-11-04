(() => {
  const connectButton = document.querySelector('#connect');
  const walletLabel = document.querySelector('#wallet-short');
  const badge = document.querySelector('.status-badge');
  const toast = document.querySelector('#toast');
  const message = document.querySelector('#proof-message');
  let toastTimer;

  function notify(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
  }

  function displayWallet(address) {
    walletLabel.textContent = `${address.slice(0, 5)}…${address.slice(-5)}`;
    connectButton.innerHTML = `${address.slice(0, 5)}…${address.slice(-5)} <span>✓</span>`;
    badge.innerHTML = '<i></i> WALLET CONNECTED';
    badge.classList.add('connected');
  }

  connectButton.addEventListener('click', async () => {
    const freighter = window.freighterApi;
    if (!freighter) {
      notify('Install Freighter to connect a Stellar Testnet wallet.');
      window.open('https://www.freighter.app/', '_blank', 'noopener,noreferrer');
      return;
    }
    connectButton.disabled = true;
    try {
      const network = await freighter.getNetwork();
      if (network.network !== 'TESTNET') {
        notify('Switch Freighter to Stellar Testnet to continue.');
        return;
      }
      const result = await freighter.requestAccess();
      if (result.error) throw new Error(result.error.message || 'Wallet access was declined');
      displayWallet(result.address);
      notify('Wallet connected. On-chain contracts are not configured in this demo yet.');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not connect wallet.');
    } finally {
      connectButton.disabled = false;
    }
  });

  document.querySelector('#start-proof').addEventListener('click', () => {
    message.textContent = 'Local proof generation needs a private issuer credential and finalized circuit artifacts. No proof or transaction was created.';
    notify('Proof generation is not enabled in this hosted prototype.');
  });
})();
