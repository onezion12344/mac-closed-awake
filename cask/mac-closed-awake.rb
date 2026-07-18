cask "mac-closed-awake" do
  version "1.0.0"
  sha256 "679d800c032cc0f1a28d53c3783f291ad610a49772c398b6164dddc4a01ca762"

  url "https://github.com/onezion12344/mac-closed-awake/releases/download/v#{version}/MacClosedAwake-v#{version}.dmg"
  name "MacClosedAwake"
  desc "Your Mac stays awake — lid closed or not"
  homepage "https://github.com/onezion12344/mac-closed-awake"

  app "MacClosedAwake.app"

  zap trash: [
    "~/Library/Application Support/MacClosedAwake",
    "~/Library/LaunchAgents/com.mca.helper.plist",
    "~/.mca",
  ]
end
