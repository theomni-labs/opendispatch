# Governance

OpenDispatch is maintained by Omni Labs.

## Roles

- **Maintainers** are members of the Omni Labs team listed in [.github/CODEOWNERS](.github/CODEOWNERS). They
  review and merge pull requests, triage issues, cut releases and set the roadmap.
- **Contributors** are everyone who opens an issue, answers a question, reviews code or sends a pull request.
  Regular contributors can be invited to become maintainers.

## Decisions

- Day-to-day decisions happen in pull requests and issues. A pull request needs one maintainer approval and a
  green CI run to merge.
- Larger changes (a new engine, a change to a contract in `contracts/`, a new dependency on an external
  service, anything that affects tenancy or security) start as an issue or discussion that explains the
  problem and the options. A maintainer records the decision there.
- If contributors disagree, maintainers aim for consensus. When that fails, the Omni Labs maintainers decide.

## Releases

Releases follow semantic versioning. Before 1.0, a minor version can contain breaking changes; they are listed
in [CHANGELOG.md](CHANGELOG.md). Release notes are generated from Conventional Commit messages.

## Licence and contributions

The project is AGPL-3.0-only and dual licensed (see [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)).
Contributions are accepted under the [CLA](CLA.md).

## Conduct

Everyone follows the [code of conduct](CODE_OF_CONDUCT.md). Reports go to omni2@theomni-labs.com.
