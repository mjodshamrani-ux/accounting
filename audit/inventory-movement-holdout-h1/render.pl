#!/usr/bin/perl
# INV-2 H1, the Perl writer: a byte-order mark, then every row ended by a
# carriage return alone, as old Mac exports do; a field is quoted only when
# it holds a comma, a quote or a line break. Reads lines of tab-separated,
# backslash-escaped cells framed by render.py on stdin.
use strict;
use warnings;
binmode STDIN, ':encoding(UTF-8)';

sub unescape {
    my ($s) = @_;
    $s =~ s/\\(.)/$1 eq 'n' ? "\n" : $1 eq 'r' ? "\r" : $1 eq 't' ? "\t" : $1/ge;
    return $s;
}
sub field {
    my ($v) = @_;
    return $v unless $v =~ /[,"\r\n]/;
    $v =~ s/"/""/g;
    return qq("$v");
}
my $out;
while (my $line = <STDIN>) {
    chomp $line;
    if ($line =~ /^FILE\t(.*)$/) {
        close $out if $out;
        open $out, '>:raw:encoding(UTF-8)', unescape($1) or die $!;
        print $out "\x{FEFF}";
    } elsif ($line eq 'ROW') {
        print $out "\r";
    } elsif ($line =~ /^ROW\t(.*)$/) {
        print $out join(',', map { field(unescape($_)) } split /\t/, $1, -1), "\r";
    }
}
close $out if $out;
