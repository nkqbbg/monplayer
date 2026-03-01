# MonPlayer Channels Scraper

This repository automatically scrapes live soccer channels from `hoadaotv.org/soccer` and generates a `channels.json` file for use in MonPlayer or similar apps.

## Data Source
- URL: `https://hoadaotv.org/soccer`
- Output: `channels.json`

## Automation
This repo is configured with a GitHub Action to update the `channels.json` file automatically every 6 hours (or manually via Actions tab).

## Usage
The raw JSON can be accessed at:
`https://raw.githubusercontent.com/<YOUR_USERNAME>/<REPO_NAME>/main/channels.json`
