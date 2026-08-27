using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class InfoSubsystemButton : GenericHoverInfo
{
    public SubsystemButton subsystem;

    public string headerText => subsystem.subsystem?.SubsystemName;

    public string buttonDescription = "";
    public override string Message => $"<b>{headerText}</b>: {subsystem.subsystem?.HealthDisplayText}";

    private string DetermineColon() {
        return string.IsNullOrWhiteSpace(buttonDescription) ? "" : ":";
    }

    // Start is called before the first frame update
    void Start()
    {
        subsystem = GetComponent<SubsystemButton>();
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
