#!/usr/bin/env perl
# Builds a file-basename -> package-name JSON index from TeX Live tlpdb files, at
# image build time, against the pinned snapshot's full remote tlpdb (architecture.md
# section 6.2: resolve by file, not by name, and do not call `tlmgr search
# --global --file` per miss — build and maintain a local index instead).
#
# Packages already present in the *local* (installed) tlpdb are excluded from the
# index: they cover the base image's scheme-basic content plus everything
# explicitly tlmgr-installed at build time (latexmk, xetex/luatex collections,
# biber/biblatex, hyphenation, minted, fontsrecommended) — the exact set that
# architecture.md section 6.6 says must never be touched by a lazy install (the
# kernel, biblatex, hyphenation patterns, and binaries/scripts tlmgr user mode
# can't install anyway). If a locally-installed file is still "missing" at compile
# time, that's a different bug (e.g. a stale/corrupt install), not something a
# second lazy install of the same package would fix — and retrying it would risk
# exactly the lazy-kernel-update failure mode section 6.6 warns against.
#
# tlpdb format (plain text, verified against the pinned 2026-10-01 snapshot):
# stanzas separated by blank lines, each starting with "name <pkg>", "category
# <cat>", then various fields; file lists appear as "runfiles size=N" / "docfiles
# size=N" / "srcfiles size=N" followed by indented " RELOC/path/to/file" lines
# (one per line) until the next unindented field or end of stanza. Only "category
# Package" stanzas provide installable package content (Collection/Scheme/TLCore/
# ConTeXt stanzas are meta-packages or out of scope), and only "runfiles" entries
# are indexed — docfiles/srcfiles are full of example.tex/test.tex/README.md
# names that would otherwise make a typo'd \input{example} try to install every
# package that ships a file by that name.
use strict;
use warnings;
use JSON::PP;

my ($local_tlpdb_path, $remote_tlpdb_path, $output_path) = @ARGV;
die "usage: $0 <local-tlpdb-path> <remote-tlpdb-path> <output-json-path>\n"
    unless $local_tlpdb_path && $remote_tlpdb_path && $output_path;

my %installed_locally = parse_package_names($local_tlpdb_path);

# basename => { pkgname => 1, ... }, built from the remote tlpdb, runfiles only,
# excluding anything already installed locally.
my %index = parse_runfiles_index($remote_tlpdb_path, \%installed_locally);

# Reduce to a single preferred package per file: prefer a package whose name
# matches the file's own stem (e.g. "polyglossia.sty" -> package "polyglossia"
# over some unrelated package that happens to also ship a file by that name),
# otherwise the alphabetically-first candidate for determinism.
my %out;
for my $basename (keys %index) {
    my @candidates = sort keys %{ $index{$basename} };
    my ($stem) = $basename =~ /^(.+?)\.[^.]+$/;
    my ($preferred) = grep { $_ eq $stem } @candidates;
    $out{$basename} = $preferred // $candidates[0];
}

open(my $out_fh, '>', $output_path) or die "cannot write $output_path: $!\n";
print $out_fh JSON::PP->new->canonical->encode(\%out);
close($out_fh);

my $count = scalar keys %out;
print "Package index: $count file entries written to $output_path "
    . "(excluded " . (scalar keys %installed_locally) . " locally-installed packages)\n";

sub parse_package_names {
    my ($path) = @_;
    open(my $fh, '<', $path) or die "cannot open $path: $!\n";
    my %names;
    while (my $line = <$fh>) {
        if ($line =~ /^name (\S+)$/) {
            $names{$1} = 1;
        }
    }
    close($fh);
    return %names;
}

sub parse_runfiles_index {
    my ($path, $exclude) = @_;
    open(my $fh, '<', $path) or die "cannot open $path: $!\n";

    my %idx;
    my $pkg_name;
    my $category = '';
    my $in_runfiles = 0;
    my $excluded_pkg = 0;

    while (my $line = <$fh>) {
        chomp $line;

        if ($line eq '') {
            $pkg_name = undef;
            $category = '';
            $in_runfiles = 0;
            next;
        }

        if ($line =~ /^name (\S+)$/) {
            $pkg_name = $1;
            $in_runfiles = 0;
            next;
        }

        if ($line =~ /^category (\S+)$/) {
            $category = $1;
            next;
        }

        if ($line =~ /^runfiles /) {
            $in_runfiles = ($category eq 'Package'
                && $pkg_name
                && !exists $exclude->{$pkg_name});
            next;
        }

        if ($line =~ /^(?:doc|src)files /) {
            $in_runfiles = 0;
            next;
        }

        # Any other unindented field line ends the current file list.
        if ($line !~ /^ /) {
            $in_runfiles = 0;
            next;
        }

        next unless $in_runfiles && $pkg_name;

        # " RELOC/tex/latex/polyglossia/polyglossia.sty" -> "polyglossia.sty"
        my ($file_path) = $line =~ /^ (\S+)/;
        next unless $file_path;
        my ($basename) = $file_path =~ m{([^/]+)$};
        next unless $basename;

        $idx{$basename}{$pkg_name} = 1;
    }
    close($fh);
    return %idx;
}
