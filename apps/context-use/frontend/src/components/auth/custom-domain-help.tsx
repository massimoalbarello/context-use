export function CustomDomainHelp() {
  return (
    <div className="grid gap-4 text-muted-foreground text-sm leading-relaxed">
      <p>
        On nibrun, you can add or change your custom domain before or after creating your account.
        Your existing passkey and account will still work.
      </p>
      <ol className="ml-5 grid list-decimal gap-3">
        <li>Add the domain in your nibrun app’s Domains tab and follow its DNS instructions.</li>
        <li>
          Set the app’s <code>BASE_URL</code> environment variable to the full URL of your desired
          custom domain, including <code>https://</code>. From a terminal signed in to nibrun,
          replace the app slug and example URL in this command:
          <code className="wrap-anywhere mt-2 block rounded-lg bg-muted p-3 text-foreground">
            nib apps update --app YOUR_APP_SLUG --env BASE_URL=https://your-domain.example
          </code>
        </li>
        <li>
          Restart the app, then open the custom domain to create your account or sign in with your
          existing passkey.
        </li>
      </ol>
      <p>
        Keep the same nibrun app. Its original <code>.nibrun.app</code> address remains your passkey
        identity, so your password manager may display that address even on the custom domain.
      </p>
      <p>
        If your browser or passkey provider does not support custom-domain sign-in, use the original
        nibrun address listed in the Domains tab. You may need to sign in separately on each domain.
      </p>
      <p>
        After changing domains, update your MCP clients to use the new MCP server URL shown in
        Settings → MCP and authorize them again.
      </p>
    </div>
  );
}
