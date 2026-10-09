import type { ResolveResult, Scope } from '../../shared/model';

export interface NavigationContext {
  inQuery: boolean;
  inAll: boolean;
  scope: Scope;
}
export interface NavigationDecision {
  kind:
    'reveal' | 'offer-clear' | 'offer-commit-history' | 'choose-ref' | 'error';
  target: ResolveResult;
  scope: Scope;
}
export function planNavigation(
  target: ResolveResult,
  view: NavigationContext,
): NavigationDecision {
  if (target.kind === 'choices')
    return { kind: 'choose-ref', target, scope: view.scope };
  if (target.kind !== 'commit')
    return { kind: 'error', target, scope: view.scope };

  return view.inQuery
    ? { kind: 'reveal', target, scope: view.scope }
    : view.inAll
      ? { kind: 'offer-clear', target, scope: { kind: 'all' } }
      : {
          kind: 'offer-commit-history',
          target,
          scope: { kind: 'commit', sha: target.commit.sha },
        };
}
