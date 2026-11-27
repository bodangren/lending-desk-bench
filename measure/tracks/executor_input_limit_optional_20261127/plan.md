# Implementation plan — executor_input_limit_optional_20261127

PM decision 2026-11-27: light lane.

## Phase 1: Optional model API input limit

- [~] 1.1 Red tests: a model API entry with only context and output limits is accepted and its config limit holds exactly those keys.

- [ ] 1.2 Green: the helper accepts input as optional.

- [ ] 1.3 Run the `executor_model_route` suite and the related regression gates.

- [ ] 1.4 Real probe: omit.
