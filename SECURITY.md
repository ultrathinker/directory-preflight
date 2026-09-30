# Security Policy

## Reporting a vulnerability

Please report security issues through GitHub Private Vulnerability Reporting: open the
**Security** tab of this repository and choose **Report a vulnerability**. Do not open a
public issue for a suspected vulnerability.

## Supported versions

Only the latest release is supported.

## Scope

This plugin runs entirely on your machine, makes no network requests, and needs no accounts or services. Its checker reads the plugin folder you point it at, runs `git` locally to read that folder's last commit, and prints a report; it writes no files. Relevant reports are about the checker reading or writing unexpected files, running anything beyond local `git`, or handling the repository contents it analyses unsafely.
