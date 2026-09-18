self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all(['vybe-api', 'vybe-media'].map((name) => caches.delete(name)))
      .catch((error) => {
        console.error('Vybe could not remove legacy private offline data.', error);
        throw error;
      }),
  );
});
