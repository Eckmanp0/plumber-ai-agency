# Voice Edge Cases

This document defines how the plumbing receptionist assistant should behave in edge-case situations.

The goal is to keep behavior:

- calm
- consistent
- truthful
- operationally useful

## Standard Rule

When the assistant is uncertain, it should:

1. avoid hallucinating
2. gather the best available contact and service details
3. use a truthful fallback outcome
4. prefer `callback_required` over invented booking or service promises

## Edge-Case Matrix

### 1. Emergency After Hours

#### Trigger

- active flooding
- burst pipe
- sewer backup
- major leak causing damage

#### Assistant Behavior

- mark urgency as high/emergency
- stay calm and direct
- collect name, phone, full service address, and issue quickly
- if immediate booking is not possible, mark callback required or urgent escalation

#### Tool Behavior

- run serviceability if location is available
- run availability if the tenant supports emergency scheduling
- create lead regardless

#### Expected Outcome

- `booked` if the system can truthfully schedule
- otherwise `callback`

### 2. Out Of Area Caller

#### Trigger

- location not in supported service area

#### Assistant Behavior

- politely explain the company may not serve that location
- do not imply service is available
- optionally collect details for manual review if desired

#### Tool Behavior

- use `check_serviceability`
- if out of area, do not promise scheduling

#### Expected Outcome

- `declined`

### 3. Unsupported Service

#### Trigger

- caller requests a service not offered by the business

#### Assistant Behavior

- politely explain the company may not currently offer that service
- do not improvise capability

#### Tool Behavior

- use `check_serviceability`

#### Expected Outcome

- `declined`

### 4. Caller Refuses Service Address

#### Trigger

- caller will not provide enough location detail to confirm serviceability

#### Assistant Behavior

- explain that the address or zip is needed to confirm service eligibility
- if they still refuse, collect name, phone, issue, and preferred time if possible

#### Tool Behavior

- do not invent serviceability
- create lead only with available data if that is still operationally useful

#### Expected Outcome

- `callback`

### 5. Caller Wants A Price Quote

#### Trigger

- caller asks what it costs before giving intake details

#### Assistant Behavior

- never invent a price
- if no pricing is provided by the business, say pricing will need to be confirmed by the plumber
- continue intake if the caller is willing

#### Tool Behavior

- continue normal flow if caller proceeds

#### Expected Outcome

- `callback` or normal booking outcome depending on intake completion

### 6. Landlord Or Property Manager Calling For Another Property

#### Trigger

- caller is not physically at the service location
- caller is booking for a tenant or another property

#### Assistant Behavior

- gather caller identity
- gather on-site service address
- clarify whether the caller is the decision-maker and best callback contact

#### Tool Behavior

- normal flow, but preserve caller and service-address distinction where possible

#### Expected Outcome

- `booked` or `callback` based on booking availability

### 7. Repeat Caller Checking Status

#### Trigger

- caller says they already called and want an update

#### Assistant Behavior

- do not fake a status
- collect identifying details
- promise callback or manual review if the live status is not available

#### Tool Behavior

- if no status lookup tool exists, create/update callback path rather than inventing one

#### Expected Outcome

- `callback`

### 8. Upset Or Distressed Caller

#### Trigger

- caller is angry, panicked, or difficult to keep on script

#### Assistant Behavior

- shorten questions
- prioritize contact info, address, urgency, and issue
- avoid overly verbose explanations

#### Tool Behavior

- create lead with partial but useful data if needed

#### Expected Outcome

- usually `callback`, unless truthful booking is still possible

### 9. No Live Availability

#### Trigger

- calendar direct tenant has no matching open slots

#### Assistant Behavior

- do not invent a slot
- offer callback scheduling
- collect preferred time windows

#### Tool Behavior

- use `check_availability`
- create lead with callback-required framing

#### Expected Outcome

- `callback`

### 10. Spam Or Wrong Number

#### Trigger

- irrelevant, abusive, prank, or unrelated caller

#### Assistant Behavior

- end politely and efficiently
- do not continue unnecessary intake

#### Tool Behavior

- avoid extra tools unless needed for logging

#### Expected Outcome

- `spam`

## Suggested Test Coverage

Use these as recurring test-call scenarios:

1. emergency burst pipe after hours
2. standard drain cleaning request
3. water heater replacement inquiry
4. out-of-area caller
5. spam or wrong number
6. direct booking using connected calendar
7. request-only callback booking request
8. landlord calling for another property
9. repeat caller checking status
10. upset caller with incomplete information

## Prompting Guidance

Prompt rules should:

1. define required fields
2. define fallback outcomes
3. define what the assistant must never invent
4. include examples of calm, concise phrasing

## Operational Guidance

If an edge case appears often, do not rely on prompt tuning alone.

Consider adding:

1. a dedicated tool
2. a new status value
3. dashboard visibility for that case
4. a support SOP entry
