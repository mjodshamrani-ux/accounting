"""Independent replay of local timer exports. It does not prove attention or field provenance."""
import json
import re
import argparse
from datetime import datetime, timezone
from pathlib import Path


def check(record):
    assert set(record) == {'kind', 'version', 'sourceSha256', 'sample', 'startedAt', 'idleAfterMs', 'events'}
    assert record['kind'] == 'review-effort' and type(record['version']) is int and record['version'] == 1
    assert isinstance(record['sourceSha256'], str) and re.fullmatch('[a-f0-9]{64}', record['sourceSha256'])
    assert record['sample'] in ('development', 'field-self-declared')
    stamp = record['startedAt']
    assert isinstance(stamp, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z', stamp)
    assert datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z') == stamp
    assert type(record['idleAfterMs']) is int and record['idleAfterMs'] == 30000
    assert isinstance(record['events'], list) and 0 < len(record['events']) <= 10000
    active = {'values': 0, 'table': 0, 'context': 0}
    rework = dict.fromkeys(active, 0)
    pauses = dict.fromkeys(('manual', 'idle', 'hidden', 'processing'), 0)
    last = interaction = 0
    stage, repeat, paused, finished = 'values', False, None, False
    clicks = changes = resumes = 0
    for e in record['events']:
        at, kind = e['atMs'], e['type']
        assert type(at) is int and last <= at <= 2**53-1 and not finished
        assert paused or at <= interaction + 30000
        if paused:
            pauses[paused] += at-last
        else:
            (rework if repeat else active)[stage] += at-last
        keys = {'type', 'atMs'}
        if kind == 'pause':
            keys.add('reason')
            assert not paused and e['reason'] in pauses
            assert e['reason'] != 'idle' or at == interaction + 30000
            paused = e['reason']
        elif kind == 'resume':
            assert paused
            paused, interaction = None, at
            resumes += 1
        elif kind == 'stage':
            keys.add('stage')
            assert e['stage'] in active
            stage = e['stage']
            if not paused: interaction = at
        elif kind == 'rework':
            keys.add('enabled')
            assert type(e['enabled']) is bool
            repeat = e['enabled']
            if not paused: interaction = at
        elif kind == 'activity':
            keys.add('action')
            assert not paused and e['action'] in ('click', 'change')
            clicks += e['action'] == 'click'
            changes += e['action'] == 'change'
            interaction = at
        elif kind == 'finish':
            keys.add('reason')
            assert e['reason'] in ('user', 'event-limit')
            finished = True
        else:
            raise AssertionError('unknown event')
        assert set(e) == keys
        last = at
    assert finished and last == sum(active.values()) + sum(rework.values()) + sum(pauses.values())
    return {'wallMs': last, 'firstMs': active, 'reworkMs': rework, 'pausedMs': pauses,
            'clicks': clicks, 'changes': changes, 'resumes': resumes}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Replay local effort records; no attention or field provenance claim.')
    parser.add_argument('--development-oracle', action='store_true', help='Also require the accelerated browser development scenario.')
    parser.add_argument('records', nargs='+')
    args = parser.parse_args()
    for name in args.records:
        p = Path(name)
        assert p.stat().st_size <= 2_000_000
        record = json.loads(p.read_text())
        result = check(record)
        if args.development_oracle:
            # These particular browser exports are accelerated known development cases.
            assert record['sample'] == 'development'
            assert result['firstMs']['values'] >= 5000 and result['firstMs']['context'] >= 1000
            assert result['reworkMs']['table'] >= 32000 and result['resumes'] == 4
            assert all(result['pausedMs'][reason] >= minimum for reason, minimum in
                       [('manual', 5000), ('idle', 5000), ('hidden', 10000), ('processing', 2000)])
            assert result['clicks'] >= 1 and result['changes'] >= 1
        classification = ('accelerated development; not human field timing' if args.development_oracle
                          else 'reviewer-declared field; provenance and attention unverified' if record['sample'] == 'field-self-declared'
                          else 'development; not independently validated human field timing')
        print(json.dumps({'file': p.name, 'sample': record['sample'], 'classification': classification, **result}))
