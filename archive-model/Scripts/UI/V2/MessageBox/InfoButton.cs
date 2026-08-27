using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

public class InfoButton : GenericHoverInfo
{

    public string headerText = "HEADER";

    public string buttonDescription = "description";
    public override string Message => $"<b>{headerText}</b>{DetermineColon()} {buttonDescription}";

    private string DetermineColon() {
        return string.IsNullOrWhiteSpace(buttonDescription) ? "" : ":";
    }

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
