import { createApp } from '../server/app.mjs';
import { configFrom } from '../server/common.mjs';

try {
  const config = configFrom();
  const { app,db,work } = await createApp(config);
  const server = app.listen(config.port,process.env.APP_BIND || (config.live?'0.0.0.0':'127.0.0.1'),()=>{
    console.log(`MakeYourStory HTTP ${config.port} · ${config.mode}`);
  });
  server.requestTimeout = 120_000;
  const timer = setInterval(work,12000);
  const close = () => {
    clearInterval(timer);
    server.close(async()=>{
      await db.close();
      process.exit(0);
    });
  };
  process.on('SIGINT',close);
  process.on('SIGTERM',close);
} catch (error) {
  console.error('startup_failed',error.code||error.name, error.status===500 ? error.message : 'Vérifiez la base et la configuration.');
  process.exitCode=1;
}
