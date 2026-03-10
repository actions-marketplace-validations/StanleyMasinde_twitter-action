import { runAction } from './action.js';
runAction().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map