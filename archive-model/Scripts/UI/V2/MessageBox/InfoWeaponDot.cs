using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class InfoWeaponDot : GenericHoverInfo
{

    public string headerText = "HEADER";

    public string buttonDescription = "description";
    public override string Message => string.Join('\n',messages);
    //$"<b>{headerText}</b>{DetermineColon()} {buttonDescription}";
    List<string> messages = new List<string>();
    private string DetermineColon() {
        return string.IsNullOrWhiteSpace(buttonDescription) ? "" : ":";
    }

    public void SetWeaponInfo(List<AttackInformation> attacks)
    {
        messages?.Clear();
        foreach(var attack in attacks)
        {
            var weaponType = attack.weaponController.weaponName;
            var message = $"<color=red><b>{weaponType}</b>";
            messages.Add(message);
        }
    }
    
    // Start is called before the first frame update
    void Start()
    {
        //messages = new List<string>();
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
