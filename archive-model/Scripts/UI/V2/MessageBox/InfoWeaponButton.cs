using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class InfoWeaponButton : GenericHoverInfo
{

    public WeaponButtonTemplate weaponController;
    public string headerText => weaponController.weaponController.weaponName;

    public string buttonDescription = "";
    public override string Message => $"<b>{headerText}</b>: {weaponController.weaponController.HealthDisplayText}";

    // private string DetermineColon() {
    //     return string.IsNullOrWhiteSpace(buttonDescription) ? "" : ":";
    // }


    // Start is called before the first frame update
    void Start()
    {
        weaponController = GetComponent<WeaponButtonTemplate>();   
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
