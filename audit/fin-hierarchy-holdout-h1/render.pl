# FIN-1 H1 writer, written here in Perl: carriage return alone ends each
# line, as classic Mac exports do; a field is quoted only when it holds a
# comma, a quote or a line break. An empty record is an empty line.
# Reads [{"path":..., "cells":[[...]]}] on stdin.
use strict;
use warnings;
use JSON::PP;

local $/;
my $files = JSON::PP->new->utf8->decode(<STDIN>);
for my $f (@$files) {
    open(my $out, '>:raw:encoding(UTF-8)', $f->{path}) or die $!;
    for my $row (@{ $f->{cells} }) {
        my @fields = map {
            my $v = $_;
            if ($v =~ /[",\r\n]/) { $v =~ s/"/""/g; $v = "\"$v\""; }
            $v;
        } @$row;
        print $out join(',', @fields), "\r";
    }
    close($out) or die $!;
}
