// SPDX-License-Identifier: AGPL-3.0-only
import { NotFoundPanel } from '@/components/opendispatch/ModuleStates';

// Unknown module slug under /ops: a 404 inside the shell, so the menu is still there.
export default function OpsNotFound() {
  return <NotFoundPanel homeHref="/ops" />;
}
