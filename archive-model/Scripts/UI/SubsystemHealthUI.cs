using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;
using UnityEngine.UI;

public class SubsystemHealthUI : MonoBehaviour
{
    public SubsytemIcons Armor;
    public SubsytemIcons Shield;
    public SubsytemIcons Weapon;
    public SubsytemIcons Thrusters;
    public SubsytemIcons LifeSupport;
    public SubsytemIcons Generator;
    public SubsytemIcons HeatExchange;

    public Image spriteImageHolder;
    public Slider subsytemHealthSlider;

    public ShipSubsystem shipSubsystem;
    public ShipController ship;

    public SubsystemType subsystemType;

    public CanvasGroup canvasGroup;



    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        if (ship.shipHealth.IsDead)
        {
            Destroy(gameObject);
        }
        else
        {
            subsytemHealthSlider.value = shipSubsystem.HealthPercent;
        }
    }

    public void AssignSubsystem(ShipController target, ShipSubsystem subsystem){
        ship = target;
        shipSubsystem = subsystem;
        Debug.LogWarning("ship " + target.gameObject.name + " setup subsystem");

        SubsystemType subsystemType = subsystem.subsystemType;

        switch(subsystem.subsystemType){
            case SubsystemType.Shield:
                spriteImageHolder.sprite = Shield.assignedSprite;
                spriteImageHolder.color = Shield.subsystemColor;
                break;
            case SubsystemType.Weapon:
                spriteImageHolder.sprite = Weapon.assignedSprite;
                spriteImageHolder.color = Weapon.subsystemColor;
                break;
            case SubsystemType.Thrusters:
                spriteImageHolder.sprite = Thrusters.assignedSprite;
                spriteImageHolder.color = Thrusters.subsystemColor;
                break;
            case SubsystemType.LifeSupport:
                spriteImageHolder.sprite = LifeSupport.assignedSprite;
                spriteImageHolder.color = LifeSupport.subsystemColor;
                break;
            case SubsystemType.Generator:
                spriteImageHolder.sprite = Generator.assignedSprite;
                spriteImageHolder.color = Generator.subsystemColor;
                break;
            case SubsystemType.HeatExchange:
                spriteImageHolder.sprite = HeatExchange.assignedSprite;
                spriteImageHolder.color = HeatExchange.subsystemColor;
                break;
            case SubsystemType.Armor:
            default:
                spriteImageHolder.sprite = Armor.assignedSprite;
                spriteImageHolder.color = Armor.subsystemColor;
                break;
        }

        
    }


}

public enum SubsystemType{
    Armor = 0,
    Shield = 1,
    Weapon = 2,
    Thrusters = 3,
    LifeSupport = 4,
    Generator = 5,
    HeatExchange = 6
}