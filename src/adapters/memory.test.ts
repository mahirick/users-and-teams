import { repositoryContract } from './contract.js';
import { createMemoryRepository } from './memory.js';

repositoryContract('memory', async () => createMemoryRepository());
