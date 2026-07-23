import { runConformance } from '../conformance/index';
import { TEST_ENGINES, createDriver } from '../test-utils/create-test-queue';

// Run the shipped driver conformance kit against both test drivers.
for (const engine of TEST_ENGINES) {
  runConformance({ name: engine, createDriver: () => createDriver(engine) });
}
